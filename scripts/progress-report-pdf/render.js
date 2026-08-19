const { chromium } = require('/Users/dev/GPC_Social_Members/node_modules/playwright');
const fs = require('fs');
const DOCS = '/Users/dev/GPC_Social_Members/docs/reporting';
const MARINE = '#052938';
const poppins = fs.readFileSync('/Users/dev/GPC_Social_Members/app/fonts/poppins-400.woff2').toString('base64');
const headerTemplate = `
<div style="width:100%;margin:0;padding:0;-webkit-print-color-adjust:exact;print-color-adjust:exact;">
  <div style="height:11mm;background:${MARINE};"></div>
  <div style="height:2px;background:${MARINE};margin:1.5mm 26mm 0 26mm;"></div>
</div>`;
const footerTemplate = `
<style>@font-face{font-family:'Poppins';src:url(data:font/woff2;base64,${poppins}) format('woff2');font-weight:400;}</style>
<div style="width:100%;font-family:'Poppins',sans-serif;font-size:7.5pt;font-weight:400;
            color:${MARINE};padding:0 26mm;display:flex;justify-content:space-between;
            -webkit-print-color-adjust:exact;">
  <span>Geneva Polo Club</span><span>Page <span class="pageNumber"></span></span>
</div>`;
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto(`file://${DOCS}/_report_cover.html`, { waitUntil: 'networkidle' });
  await page.emulateMedia({ media: 'print' });
  await page.pdf({ path: `${DOCS}/_rcover.pdf`, format: 'A4', printBackground: true,
                   margin: { top: 0, right: 0, bottom: 0, left: 0 } });
  await page.goto(`file://${DOCS}/_report_body.html`, { waitUntil: 'networkidle' });
  await page.emulateMedia({ media: 'print' });
  await page.pdf({ path: `${DOCS}/_rbody.pdf`, format: 'A4', printBackground: true,
                   displayHeaderFooter: true, headerTemplate, footerTemplate,
                   margin: { top: '24mm', right: '26mm', bottom: '18mm', left: '26mm' } });
  await browser.close();
  console.log('rendered report');
})();
