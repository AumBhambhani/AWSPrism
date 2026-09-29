/**
 * Theme-aware PRISM logo.
 * Renders both images; CSS shows/hides based on [data-theme].
 */
export default function Logo({ className = "", style = {}, alt = "PRISM" }) {
  return (
    <>
      <img
        src="/prism-logo.png"
        alt={alt}
        className={`prism-logo-light ${className}`}
        style={style}
      />
      <img
        src="/prism-logo-dark.png"
        alt={alt}
        className={`prism-logo-dark ${className}`}
        style={style}
      />
    </>
  );
}
