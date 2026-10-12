// A CDP session to the page's dedicated worker (D-L3, story 5.24). Playwright
// gives a session per page; a worker is its own target, so the CPU throttle
// and the heap sampler must be sent to it separately. Commands go through the
// browser session's `Target.sendMessageToTarget`.

import type { Browser } from "@playwright/test";

export interface WorkerCdp {
  send(method: string, params?: object): Promise<unknown>;
  detach(): Promise<void>;
}

interface BrowserSession {
  send(method: string, params?: object): Promise<unknown>;
  on(event: string, handler: (payload: never) => void): void;
  detach(): Promise<void>;
}

/** Attaches to the first dedicated worker whose url contains `urlPart`. */
export async function attachWorker(browser: Browser, urlPart: string): Promise<WorkerCdp> {
  const session = (await browser.newBrowserCDPSession()) as unknown as BrowserSession;
  const targets = (await session.send("Target.getTargets")) as {
    targetInfos: { targetId: string; type: string; url: string }[];
  };
  const target = targets.targetInfos.find((t) => t.type === "worker" && t.url.includes(urlPart));
  if (!target) throw new Error(`no worker target whose url contains '${urlPart}'`);
  const attached = (await session.send("Target.attachToTarget", {
    targetId: target.targetId,
    flatten: false,
  })) as { sessionId: string };
  const sessionId = attached.sessionId;

  let nextId = 1;
  const waiting = new Map<number, (r: { result?: unknown; error?: { message: string } }) => void>();
  session.on("Target.receivedMessageFromTarget", ((e: { sessionId: string; message: string }) => {
    if (e.sessionId !== sessionId) return;
    const message = JSON.parse(e.message) as {
      id?: number;
      result?: unknown;
      error?: { message: string };
    };
    if (message.id === undefined) return;
    waiting.get(message.id)?.(message);
    waiting.delete(message.id);
  }) as never);

  return {
    send(method, params = {}) {
      const id = nextId++;
      return new Promise((resolve, reject) => {
        waiting.set(id, (m) => (m.error ? reject(new Error(m.error.message)) : resolve(m.result)));
        void session.send("Target.sendMessageToTarget", {
          sessionId,
          message: JSON.stringify({ id, method, params }),
        });
      });
    },
    async detach() {
      await session.send("Target.detachFromTarget", { sessionId }).catch(() => undefined);
      await session.detach().catch(() => undefined);
    },
  };
}
