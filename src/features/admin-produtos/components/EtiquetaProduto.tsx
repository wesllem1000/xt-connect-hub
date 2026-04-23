import QRCode from 'qrcode'

type Props = {
  serial: string
  pairingCode: string
  claimUrl: string
}

/**
 * Abre janela nova com a etiqueta pré-renderizada (SVG inline — sem CDN)
 * e dispara window.print(). Tamanho da etiqueta: 50mm × 30mm.
 */
export async function openEtiquetaProduto(props: Props) {
  let qrSvg = ''
  try {
    qrSvg = await QRCode.toString(props.claimUrl, {
      type: 'svg',
      margin: 0,
      errorCorrectionLevel: 'M',
    })
  } catch {
    qrSvg = '<svg width="22mm" height="22mm"></svg>'
  }

  const w = window.open('', '_blank', 'width=480,height=320')
  if (!w) return

  const html = `<!doctype html>
<html>
<head>
<meta charset="utf-8"/>
<title>Etiqueta ${escapeHtml(props.serial)}</title>
<style>
  @page { size: 50mm 30mm; margin: 0; }
  html, body { margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #fff; color: #000; }
  .label { width: 50mm; height: 30mm; box-sizing: border-box; padding: 1.5mm 2mm;
           display: grid; grid-template-columns: 22mm 1fr; gap: 1.5mm; align-items: center; }
  .qr svg { width: 22mm; height: 22mm; display: block; }
  .info { display: flex; flex-direction: column; justify-content: center; line-height: 1.1; }
  .brand { font-size: 6pt; color: #555; text-transform: uppercase; letter-spacing: 0.5px; }
  .serial { font-family: 'Courier New', monospace; font-size: 8pt; font-weight: 600; margin: 0.5mm 0; }
  .pairing { font-family: 'Courier New', monospace; font-size: 14pt; font-weight: 700; letter-spacing: 2px; }
  .url { font-size: 6pt; color: #666; margin-top: 0.5mm; }
  @media screen {
    body { background: #eee; padding: 24px; display: flex; justify-content: center; }
    .label { box-shadow: 0 1px 4px rgba(0,0,0,.2); background: #fff; }
  }
</style>
</head>
<body>
<div class="label">
  <div class="qr">${qrSvg}</div>
  <div class="info">
    <div class="brand">XT Conect Hub</div>
    <div class="serial">${escapeHtml(props.serial)}</div>
    <div class="pairing">${escapeHtml(props.pairingCode)}</div>
    <div class="url">hub.xtconect.online/claim</div>
  </div>
</div>
<script>setTimeout(function(){window.print();},200);</script>
</body>
</html>`

  w.document.open()
  w.document.write(html)
  w.document.close()
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}
