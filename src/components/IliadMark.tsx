// The Iliad sail mark, extracted from the full logo (iliad_logo.svg: sail +
// wordmark + background) and simplified to a small polygon. Inlined as SVG so
// it scales, takes the text color, and doesn't need a network round-trip.
export function IliadMark({ size = 20, className }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="408 317 373 365"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
    >
      <path
        d="M438 681L435 681.4L434.8 680L444.7 668L458.9 647L474 619L483.6 596L490.4 575L496.9 546L499.2 529L500.6 512L499.5 480L496.5 458L490 430.7L483.9 413L474.5 392L459 366.3L442 345.1L427 331.1L408.9 319L409.5 318L423 317.8L471 322L557.2 337L660 360.2L700 370.6L730 379.5L743.1 396L753.4 412L760 424L770 447L774.8 463L778.4 480L780.5 503L780.3 516L778.4 534L775 551L770.1 567L757.9 596L743 619.5L736 627.8L728 614.4L717 608.7L705 604.7L689 601.9L667 600.6L642 601.7L623.5 604L604 608.1L580 614.6L557 622.5L535.8 631L506.6 644L473 660.7Z"
        fill="currentColor"
      />
    </svg>
  );
}
