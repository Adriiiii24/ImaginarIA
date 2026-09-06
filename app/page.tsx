import { BackgroundShapes } from "@/components/BackgroundShapes";
import { Personaje } from "@/components/Personaje";
import { PaletaProvider } from "@/components/palette";
import { ChatContainer } from "@/components/chat/ChatContainer";

/**
 * Aplicación a pantalla completa: azul de fondo, cuatro figuras flotando y el
 * chat centrado sobre ellas en una lámina de cristal.
 *
 * Es la que se despliega de forma independiente y la que el portfolio carga
 * en el iframe del panel lateral.
 */
export default function Home() {
  return (
    <main className="relative flex flex-1 items-center justify-center overflow-hidden p-3 sm:p-6">
      <PaletaProvider>
        <BackgroundShapes />

      {/* z-10 sobre las figuras. La altura se limita para que en pantallas
          altas el panel siga leyéndose como una tarjeta flotante y no como
          una columna estirada. */}
        {/* Envoltorio para que el personaje se posicione respecto al panel y
            no respecto a la pagina. El panel va por encima (z-10) y le tapa
            las piernas; el personaje queda en z-0 dentro de este contenedor. */}
        <div className="relative z-10 flex h-full max-h-[44rem] w-full max-w-xl">
          <Personaje />
          <div className="im-glass relative z-10 flex w-full flex-col overflow-hidden rounded-im-lg">
            <ChatContainer autoFocus />
          </div>
        </div>
      </PaletaProvider>
    </main>
  );
}
