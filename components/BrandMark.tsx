/**
 * La marca de la cabecera: las cuatro figuras del fondo en miniatura, en la
 * misma disposición que ocupan en pantalla.
 *
 * Se pinta con las variables de la paleta, así que se recolorea sola cuando
 * el botón gira los colores. No necesita estado ni saber que la rotación
 * existe: es una consecuencia de leer las mismas variables que las figuras
 * grandes.
 *
 * El logotipo 3D con brillos que había antes chocaba con un sistema plano y
 * geométrico; esto sale del propio lenguaje visual de la aplicación.
 */
export function BrandMark({ size = 20 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 22 22"
      fill="none"
      aria-hidden
      // La misma curva y duración que el fondo, para que la marca cambie con
      // la misma ola y no por su cuenta.
      className="shrink-0 [&>*]:transition-[fill] [&>*]:duration-700 [&>*]:ease-[cubic-bezier(0.65,0,0.35,1)]"
    >
      <circle cx="5.5" cy="5.5" r="4.5" fill="var(--im-shape-1)" />
      <path d="M16.5 1 21 10H12L16.5 1Z" fill="var(--im-shape-2)" />
      <rect x="1" y="12" width="9" height="9" rx="2.4" fill="var(--im-shape-3)" />
      <path
        d="M16.5 11.5 21 16.25 16.5 21 12 16.25 16.5 11.5Z"
        fill="var(--im-shape-4)"
      />
    </svg>
  );
}
