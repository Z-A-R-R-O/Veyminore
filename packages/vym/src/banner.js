export const banner = [
'██╗░░░██╗███████╗██╗░░░██╗███╗░░░███╗██╗███╗░░██╗░█████╗░██████╗░███████╗',
'██║░░░██║██╔════╝╚██╗░██╔╝████╗░████║██║████╗░██║██╔══██╗██╔══██╗██╔════╝',
'╚██╗░██╔╝█████╗░░░╚████╔╝░██╔████╔██║██║██╔██╗██║██║░░██║██████╔╝█████╗░░',
'░╚████╔╝░██╔══╝░░░░╚██╔╝░░██║╚██╔╝██║██║██║╚████║██║░░██║██╔══██╗██╔══╝░░',
'░░╚██╔╝░░███████╗░░░██║░░░██║░╚═╝░██║██║██║░╚███║╚█████╔╝██║░░██║███████╗',
'░░░╚═╝░░░╚══════╝░░░╚═╝░░░╚═╝░░░░░╚═╝╚═╝╚═╝░░╚══╝░╚════╝░╚═╝░░╚═╝╚══════╝'
];

export const brandColors = Object.freeze({iris:'#A995FF',copper:'#F0AD8E',highlight:'#F5ECFF'});
const paint = line => `\x1b[38;2;169;149;255m${line}\x1b[0m`;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

export async function showBanner({output = process.stdout, env = process.env, animate = true} = {}) {
  const wide = !output.isTTY || (output.columns || 80) >= 82;
  const lines = (wide ? banner : ['VEYMINORE']).map(line => '  ' + line.replaceAll('░', ' '));
  const colorEnabled = output.isTTY && env.TERM !== 'dumb' && env.NO_COLOR === undefined;
  const staticMark = lines.map(line => colorEnabled ? paint(line) : line).join('\n');
  const motion = animate && colorEnabled && !env.VYM_REDUCED_MOTION && wide;
  if (!motion) { output.write(staticMark + '\n\n'); return; }
  output.write('\x1b[?25l');
  try {
    for (const line of lines) { output.write(paint(line) + '\n'); await pause(45); }
    // A narrow light seam crosses the completed mark, then settles to plain text.
    for (let seam = -8; seam < 88; seam += 8) {
      output.write(`\x1b[${lines.length}A\r`);
      for (const line of lines) {
        let frame = '';
        for (let col = 0; col < line.length; col++) {
          const distance = Math.abs(col - seam);
          const color = distance < 3 ? '245;236;255' : distance < 8 ? '240;173;142' : '169;149;255';
          frame += `\x1b[38;2;${color}m${line[col]}`;
        }
        output.write('\r\x1b[2K' + frame + '\x1b[0m\n');
      }
      await pause(25);
    }
    output.write(`\x1b[${lines.length}A\r` + staticMark + '\n\n');
  } finally { output.write('\x1b[0m\x1b[?25h'); }
}
