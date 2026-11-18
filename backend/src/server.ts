import { startServer } from './bootstrap';
import { parseEnv } from './lib/env';

startServer(parseEnv());
