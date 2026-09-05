import { ChatContainer } from "@/components/chat/ChatContainer";

/**
 * Aplicacion en pantalla completa: es la que se despliega de forma
 * independiente y la que el portfolio carga en el iframe del panel lateral.
 */
export default function Home() {
  return (
    <main className="flex flex-1 flex-col">
      <ChatContainer autoFocus />
    </main>
  );
}
