# Visual baselines

These PNG files are the reviewed reference renders for the browser regression
suite. Update and review instructions are in the root
[AGENTS.md](../../AGENTS.md#验证与交付).

The comparison ignores minor antialiasing differences but fails when more than
1.5% of a slide differs materially. Geometry and visibility assertions in the
same suite cover small layout defects that may occupy fewer pixels.
