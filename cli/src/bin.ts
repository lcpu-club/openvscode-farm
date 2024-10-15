#!/usr/bin/env node

import { cli } from './cli/index.js'

const [, , ...args] = process.argv
cli.runExit(args)
