/* eslint-disable no-console */

const fs = require('fs');
const path = require('path');

async function main() {
  const { Resvg } = require('@resvg/resvg-js');

  const projectRoot = path.resolve(__dirname, '..');
  const inputSvgPath = path.join(projectRoot, 'assets', 'add-to-apple-wallet.svg');
  const outputPngPath = path.join(projectRoot, 'assets', 'add-to-apple-wallet.png');

  if (!fs.existsSync(inputSvgPath)) {
    console.error(`Missing input SVG: ${inputSvgPath}`);
    process.exit(1);
  }

  const svg = fs.readFileSync(inputSvgPath, 'utf8');

  // Render at higher resolution for crispness on Retina displays.
  // The source SVG viewBox is ~110.739x35.016. Scaling to width 1100 gives plenty of detail.
  const resvg = new Resvg(svg, {
    fitTo: { mode: 'width', value: 1100 },
    background: null,
  });

  const pngData = resvg.render().asPng();
  fs.writeFileSync(outputPngPath, pngData);

  console.log(`Wrote: ${outputPngPath} (${pngData.length} bytes)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
