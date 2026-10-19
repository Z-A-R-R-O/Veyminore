export function renderConsole({product = null, color = false, columns = 88} = {}) {
  const ink = (text, rgb, bold = false) => color ? `\x1b[${bold ? '1;' : ''}38;2;${rgb}m${text}\x1b[0m` : text;
  const iris = text => ink(text, '169;149;255', true);
  const copper = text => ink(text, '240;173;142');
  const muted = text => ink(text, '160;164;178');
  const title = text => ink(text, '235;231;245', true);
  const width = Math.min(74, Math.max(30, columns - 8));
  const rule = muted('  ' + '─'.repeat(width));
  const section = (number, heading, subtitle) => `  ${copper(number)}   ${title(heading)}\n       ${muted(subtitle)}`;
  const row = (command, description) => columns < 66
    ? `       ${iris(command)}\n         ${muted(description)}\n`
    : `       ${iris(command.padEnd(27))}${muted(description)}\n`;
  const lines = [
    `  ${title('V E Y M I N O R E')}     ${copper('WORKSPACE CONSOLE')}\n`,
    `  ${muted('A considered space for everything you build.')}\n`,
    rule + '\n',
    section('01', 'YOUR PRODUCTS', 'One entry point. A growing ecosystem.') + '\n',
    row('vym zetro', 'ZETRO · Coding & Computing'),
    section('02', 'YOUR WAY IN', 'Short name. Full name. Same workspace.') + '\n',
    row('vym status', 'Workspace and dashboard health'),
    row('vym workers', 'Saved assignments across AGR and OCR'),
    row('vym doctor', 'Check local requirements'),
    row('vym help', 'Explore available commands'),
    row('veyminore', 'The full signature · all commands supported'),
    section('03', 'MAKE IT YOURS', 'Quiet when you need it. Structured when you build.') + '\n',
    row('vym --no-animation', 'A still, color-preserving introduction'),
    row('vym status --watch', 'Refresh every five seconds'),
    row('vym --json', 'Clean output for scripts and integrations')
  ];
  if (product === 'zetro') lines.push(
    section('04', 'ZETRO CONSOLE', 'Your local window into the work.') + '\n',
    `       ${iris('http://127.0.0.1:4317')}\n`,
    `       ${muted('Open after starting the control-center server.')}\n`
  );
  lines.push(rule + '\n', `  ${copper('PREVIEW  /  0.1')}    ${muted('Local launcher · service controls are not connected.')}\n`,
    `  ${muted('Built with intention.  VEYMINORE.')}\n`);
  return lines.join('\n');
}
