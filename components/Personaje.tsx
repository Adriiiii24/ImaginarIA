import Image from "next/image";

/**
 * La mascota de ImaginarIA, apoyada en el borde del panel.
 *
 * Va DETRAS del cristal (z menor) a proposito: asi el panel le tapa parte del
 * cuerpo y se lee como alguien apoyado en una pared, no como una pegatina
 * encima. El codo doblado queda por fuera, que es lo que vende la postura.
 *
 * pointer-events-none para que no robe clics al chat, y aria-hidden porque no
 * comunica nada: anunciarlo solo mete ruido antes del contenido real.
 *
 * Oculto por debajo de lg: en pantallas estrechas el panel ocupa casi todo el
 * ancho y el personaje se le montaria encima en vez de acompanarlo.
 */
export function Personaje() {
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute bottom-0 left-full z-0 hidden w-[19rem] -translate-x-[14%] xl:block"
    >
      <Image
        src="/personaje.png"
        alt=""
        width={611}
        height={900}
        priority
        className="h-auto w-full drop-shadow-[6px_6px_0_rgba(11,11,20,0.35)]"
      />
    </div>
  );
}
