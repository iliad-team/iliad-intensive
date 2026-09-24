"""
Live training curves that cost the training loop (almost) nothing.

`LivePlot` shows a grid of matplotlib panels in the notebook output and keeps
them updated while a training loop runs. The training thread only appends
numbers: a separate *render process* owns the figure, redraws it at most once
every `refresh_seconds`, and hands back PNG bytes, which the training thread
swaps into a fixed output cell (`update_display`) in about a millisecond.
Nothing in the loop ever waits for matplotlib, and the output is a plain
image, so it works the same in Jupyter, Colab, VS Code and Cursor -- no
widgets, no CDN, no JavaScript.

    plot = LivePlot(
        [
            {"title": "losses", "metrics": ["loss", "actor", "critic"]},
            {"title": "return / entropy", "metrics": ["return"], "secondary": ["entropy"]},
        ],
        total_steps=num_steps,
    )
    try:
        for step in range(num_steps):
            plot.log(step, train_step())
    finally:
        plot.finish()   # draw the final frame and shut the renderer down

A panel spec is a metric name (one curve on its own panel) or a dict with
`metrics` (curves sharing the left axis, with a legend), optional `secondary`
(curves on a right-hand axis, for quantities on a different scale) and an
optional `title`. Every axis autoscales as data arrives.

If the render process can't be started, rendering falls back to the calling
thread (a warning says so). Outside a notebook there is nothing to draw on,
so `LivePlot` just collects the metrics (`plot.data`) and starts no process.

This module deliberately imports nothing heavy (no torch): the render process
imports it afresh, so keeping it light keeps the renderer's startup ~0.1 s.
"""

from __future__ import annotations

import io
import math
import multiprocessing as mp
import queue
import sys
import time
import warnings


def _normalise_panel(spec) -> dict:
    if isinstance(spec, str):
        return {"title": spec, "metrics": [spec], "secondary": []}
    metrics, secondary = list(spec.get("metrics", [])), list(spec.get("secondary", []))
    assert metrics or secondary, "a panel needs at least one metric"
    title = spec.get("title") or " / ".join(metrics + secondary)
    return {"title": title, "metrics": metrics, "secondary": secondary}


# --------------------------------------------------------------------------- the figure


class _FigureRenderer:
    """
    Owns one matplotlib figure and the metric history it draws. Built on the
    object-oriented API (no pyplot), so it has no global state and works the
    same inside the render process or on the calling thread.
    """

    def __init__(self, panels, total_steps, max_cols, cell_size, dpi):
        import matplotlib
        from matplotlib.backends.backend_agg import FigureCanvasAgg
        from matplotlib.figure import Figure

        n = len(panels)
        cols, rows = min(max_cols, n), math.ceil(n / max_cols)
        self.fig = Figure(figsize=(cell_size[0] * cols, cell_size[1] * rows))
        FigureCanvasAgg(self.fig)
        axes = self.fig.subplots(rows, cols, squeeze=False).flatten()
        palette = matplotlib.rcParams["axes.prop_cycle"].by_key()["color"]
        self.dpi = dpi
        self.fixed_x = bool(total_steps)
        self.lines, self.hist = {}, {}
        for ax, panel in zip(axes, panels):
            names = panel["metrics"] + panel["secondary"]
            ax2 = ax.twinx() if panel["secondary"] else None
            handles = []
            for j, name in enumerate(names):
                target = ax2 if name in panel["secondary"] else ax
                (line,) = target.plot([], [], lw=1.2, color=palette[j % len(palette)], label=name)
                self.lines[name], self.hist[name] = line, ([], [])
                handles.append(line)
            ax.set_title(panel["title"])
            ax.set_xlabel("step")
            if total_steps:
                ax.set_xlim(0, total_steps)
            if len(names) > 1:
                ax.legend(handles, names, loc="best", fontsize=8)
            if ax2 is not None:
                ax.set_ylabel(", ".join(panel["metrics"]))
                ax2.set_ylabel(", ".join(panel["secondary"]))
        for ax in axes[n:]:
            ax.set_visible(False)
        self.fig.tight_layout()

    def add(self, step: int, metrics: dict):
        for name, value in metrics.items():
            if name in self.hist:
                self.hist[name][0].append(step)
                self.hist[name][1].append(float(value))

    def render(self) -> bytes:
        for name, (xs, ys) in self.hist.items():
            self.lines[name].set_data(xs, ys)
        for line in self.lines.values():
            line.axes.relim()
            line.axes.autoscale_view(scalex=not self.fixed_x)
        buf = io.BytesIO()
        self.fig.savefig(buf, format="png", dpi=self.dpi)
        return buf.getvalue()


# --------------------------------------------------------------------------- the render process


def _render_worker(panels, inbox, outbox, refresh_seconds, max_cols, cell_size, dpi, total_steps):
    """
    Loop: collect (step, metrics) messages from `inbox`, redraw at most once per
    `refresh_seconds` while there is new data, put PNG bytes on `outbox`. A
    `None` message means finish: draw one last frame, put `None`, exit.
    """
    renderer = _FigureRenderer(panels, total_steps, max_cols, cell_size, dpi)
    dirty, last_draw, running = False, 0.0, True
    while running:
        try:
            msg = inbox.get(timeout=refresh_seconds)  # wake at least once per interval
        except queue.Empty:
            msg = ()
        pending = [msg] if msg != () else []
        while True:  # drain whatever else is queued so one redraw covers many steps
            try:
                pending.append(inbox.get_nowait())
            except queue.Empty:
                break
        for item in pending:
            if item is None:
                running = False
            else:
                renderer.add(*item)
                dirty = True
        now = time.monotonic()
        if dirty and (not running or now - last_draw >= refresh_seconds):
            outbox.put(renderer.render())
            dirty, last_draw = False, now
    outbox.put(None)


# --------------------------------------------------------------------------- the handle


class LivePlot:
    def __init__(
        self,
        panels: list,
        total_steps: int | None = None,
        refresh_seconds: float = 1.0,
        max_cols: int = 3,
        cell_size: tuple = (5, 3.5),
        dpi: int = 100,
    ):
        self.panels = [_normalise_panel(p) for p in panels]
        self.metric_names = [n for p in self.panels for n in p["metrics"] + p["secondary"]]
        self.data = {n: ([], []) for n in self.metric_names}  # full history, kept on this side too
        self.refresh_seconds = refresh_seconds
        self.last_png: bytes | None = None
        self._handle = self._make_display_handle()
        self._done = False
        self._proc = self._renderer = None
        self._last_draw = 0.0
        if self._handle is None:
            self.mode = "off"  # not in a notebook: nothing to draw on, just collect metrics
            return
        try:
            self._start_process(total_steps, max_cols, cell_size, dpi)
            self.mode = "process"
        except Exception as e:  # noqa: BLE001 - whatever stops the process, keep the plot working
            warnings.warn(
                f"LivePlot: could not start the render process ({type(e).__name__}: {e}); "
                f"rendering on the training thread instead (~0.15 s per redraw).",
                stacklevel=2,
            )
            self._renderer = _FigureRenderer(self.panels, total_steps, max_cols, cell_size, dpi)
            self.mode = "thread"

    # -- setup -------------------------------------------------------------------

    @staticmethod
    def _make_display_handle():
        try:
            from IPython import get_ipython
            from IPython.display import HTML, display
        except ImportError:
            return None
        if get_ipython() is None:
            return None
        return display(HTML("<i>live plot: waiting for the first frame…</i>"), display_id=True)

    def _start_process(self, total_steps, max_cols, cell_size, dpi):
        # "spawn", never "fork": the notebook process has usually initialised CUDA,
        # and a forked child inherits a CUDA context it must not touch.
        ctx = mp.get_context("spawn")
        self._inbox, self._outbox = ctx.Queue(), ctx.Queue()
        self._proc = ctx.Process(
            target=_render_worker,
            args=(self.panels, self._inbox, self._outbox, self.refresh_seconds, max_cols, cell_size, dpi, total_steps),
            daemon=True,
        )
        # A spawned child re-runs the parent's __main__ *file* if there is one. In a
        # notebook there isn't; in an interactive window / `python solutions.py`-style
        # session `__main__.__file__` points at the whole notebook script, which the
        # renderer has no use for (it would import torch and build environments just to
        # draw a plot). Hide it for the duration of start() so the child stays light.
        main = sys.modules.get("__main__")
        hidden = {k: main.__dict__.pop(k) for k in ("__file__", "__cached__") if main is not None and k in main.__dict__}
        try:
            self._proc.start()
        finally:
            if main is not None:
                main.__dict__.update(hidden)

    # -- use ----------------------------------------------------------------------

    def log(self, step: int, metrics: dict):
        """Record one step's metrics. Unknown metric names are ignored."""
        picked = {k: float(v) for k, v in metrics.items() if k in self.data}
        for name, value in picked.items():
            self.data[name][0].append(step)
            self.data[name][1].append(value)
        if self.mode == "process":
            self._inbox.put((step, picked))
            self._collect(block=False)
        elif self.mode == "thread":
            self._renderer.add(step, picked)
            if time.monotonic() - self._last_draw >= self.refresh_seconds:
                self._show(self._renderer.render())

    def refresh(self):
        """Force a redraw now (thread mode only; the render process paces itself)."""
        if self.mode == "thread":
            self._show(self._renderer.render())

    def finish(self):
        """Draw the final frame and shut the renderer down. Safe to call twice."""
        if self._done:
            return
        self._done = True
        if self.mode == "process":
            if self._proc.is_alive():
                self._inbox.put(None)
                self._collect(block=True)
            self._proc.join(timeout=5)
        elif self.mode == "thread":
            self._show(self._renderer.render())

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        self.finish()

    # -- plumbing -----------------------------------------------------------------

    def _collect(self, block: bool, timeout: float = 15.0):
        """Take the newest frame off the outbox (if any) and display it."""
        png, deadline = None, time.monotonic() + timeout
        while True:
            try:
                item = self._outbox.get(timeout=max(0.0, deadline - time.monotonic())) if block else self._outbox.get_nowait()
            except queue.Empty:
                break
            if item is None:  # renderer has sent its final frame
                block = False
                break
            png = item
            if not block:
                break
            if not self._proc.is_alive() and self._outbox.empty():
                break
        if png is not None:
            self._show(png)

    def _show(self, png: bytes):
        self.last_png = png
        self._last_draw = time.monotonic()
        if self._handle is not None:
            from IPython.display import Image

            self._handle.update(Image(data=png, format="png"))
