/**
 * Las cuatro figuras que flotan detrás del chat, una por cada color de la
 * paleta que no es el azul del fondo.
 *
 * Deliberadamente sin JavaScript: es un componente de servidor y el
 * movimiento son animaciones CSS. Un bucle infinito hecho con Framer Motion
 * mantendría cuatro animaciones vivas en el hilo principal durante toda la
 * sesión para algo que el compositor resuelve solo. Además, así el CSS las
 * detiene sin que intervenga React: con prefers-reduced-motion, o con la
 * pausa de la cabecera (ver PaletaProvider).
 *
 * aria-hidden porque no comunican nada: si un lector de pantalla las anuncia,
 * solo añade ruido antes del contenido real.
 */
export function BackgroundShapes() {
  return (
    <div className="im-shapes" aria-hidden>
      <span className="im-shape im-shape--circle" />
      <span className="im-shape im-shape--triangle" />
      <span className="im-shape im-shape--square" />
      <span className="im-shape im-shape--diamond" />
    </div>
  );
}
