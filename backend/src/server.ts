import { createApp } from './app';
import { parseEnv } from './lib/env';

const env = parseEnv();

const app = createApp();

app.listen(env.PORT, () => {
  console.log(`destrabe backend listening on :${env.PORT} (${env.NODE_ENV})`);
});
