// Proxy TCP kecil di depan `next start` untuk test offline. context.setOffline() Playwright
// tidak berlaku untuk service worker yang dimulai ulang browser, sehingga request SW tetap
// sampai ke server. Menutup proxy ini membuat jaringan benar-benar putus (koneksi ditolak)
// untuk halaman maupun service worker.
import net from 'node:net';

export interface CutProxy {
  url: string;
  cut(): Promise<void>;
  close(): Promise<void>;
}

export async function startCutProxy(target: URL): Promise<CutProxy> {
  const sockets = new Set<net.Socket>();
  let server: net.Server | null = null;
  const listen = (port: number) =>
    new Promise<number>((resolve, reject) => {
      server = net.createServer((client) => {
        const upstream = net.connect(Number(target.port || 80), target.hostname);
        for (const s of [client, upstream]) {
          sockets.add(s);
          s.on('close', () => sockets.delete(s));
          s.on('error', () => s.destroy());
        }
        client.pipe(upstream).pipe(client);
      });
      server.once('error', reject);
      server.listen(port, '127.0.0.1', () => resolve((server!.address() as net.AddressInfo).port));
    });
  const port = await listen(0);
  const close = async () => {
    for (const s of sockets) s.destroy();
    await new Promise<void>((r) => (server ? server.close(() => r()) : r()));
    server = null;
  };
  return { url: `http://localhost:${port}`, cut: close, close };
}
