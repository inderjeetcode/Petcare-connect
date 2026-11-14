BEGIN;

SELECT plan(1);

SELECT ok(
  true,
  'pgTAP assertion engine works'
);

SELECT * FROM finish();

ROLLBACK;