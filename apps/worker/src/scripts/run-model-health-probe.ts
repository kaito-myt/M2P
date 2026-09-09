import { runModelHealthProbe } from '../tasks/model-health-probe.js';

runModelHealthProbe()
  .then((r) => {
    console.log('RESULT', JSON.stringify(r));
    process.exit(0);
  })
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
