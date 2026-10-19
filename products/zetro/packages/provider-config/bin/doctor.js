#!/usr/bin/env node

/**
 * ZETRO Provider Doctor CLI
 *
 * Owned by AGR-5.
 */

import { runDoctorCli } from '../src/doctor.js';

const { exitCode } = runDoctorCli(process.argv.slice(2));
process.exit(exitCode);
