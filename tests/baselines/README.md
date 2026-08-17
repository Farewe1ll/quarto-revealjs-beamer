# Visual baselines

These PNG files are the reviewed reference renders for the browser regression
suite. Run `npm run test:update-visuals` only when an intentional design change
requires new baselines, then inspect every changed image before committing it.

The comparison ignores minor antialiasing differences but fails when more than
1.5% of a slide differs materially. Geometry and visibility assertions in the
same suite cover small layout defects that may occupy fewer pixels.
