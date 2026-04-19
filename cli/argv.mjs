export function parseArgv(argv) {
  const options = { _: [], '--': [] };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === '--') {
      options['--'] = argv.slice(index + 1);
      break;
    }

    if (!arg.startsWith('--')) {
      options._.push(arg);
      continue;
    }

    const raw = arg.slice(2);
    const equalIndex = raw.indexOf('=');
    if (equalIndex !== -1) {
      const key = raw.slice(0, equalIndex);
      options[key] = raw.slice(equalIndex + 1);
      continue;
    }

    const next = argv[index + 1];
    if (next && !next.startsWith('--')) {
      options[raw] = next;
      index += 1;
      continue;
    }

    options[raw] = true;
  }

  return options;
}
