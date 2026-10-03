# Resident portrait assets

Approved by the user: NPC concept with Lume, Brik and Orin, followed by request to apply it while matching world NPC pixel density to the keeper.

`resident-portraits.png` is a built-in image_gen generated atlas (2048×768). It is loaded once, sampled into three cached 128×144 UI portraits. Runtime source rectangles avoid neighbouring silhouettes. World sprites are authored separately in `src/ui/town-residents.ts` on 24×24 native canvases; no bitmap portrait is reused as a world model.

Source concept: exec-be658eac-9959-4413-91cd-9a86db6af573.png.
Generation result: exec-11474951-1fb7-4a31-ac7a-41ef1d945977.png.

## Final generation prompt
Production asset extraction / refinement of the APPROVED reference character designs. Create a single transparent PNG sprite atlas containing ONLY THREE chest-up NPC portraits side by side in equal-width cells. Wide aspect ratio 8:3, ideally 1536x576. Cells exactly left third, middle third, right third, each full height. Each portrait centered in its cell with small equal transparent margins; ALL ears and handheld props fully within cell; torso cut at bottom baseline. Preserve the approved reference upper portraits faithfully: LEFT Lume cream cat amber gentle worried eyes, dusty purple cloak, rose scarf brass brooch, paw holding glowing lantern; MIDDLE Brik orange tabby warmly smiling closed eyes, olive rolled sleeves, leather apron and hammer; RIGHT Orin blue gray cat round brass spectacles teal eyes, teal scholarly coat cream collar with burgundy book, thoughtful paw. Same beautiful crisp pixel-art clusters and shaded fabric/fur as the reference, no smoother repaint or redesign. No layout frame, no text whatsoever, no labels, no small world sprites, no UI, no background, no contact shadows. This atlas will be divided at exact one-third boundaries in the game UI. Transparent background is essential. Keep all three portraits the same visual height and matching head scale. Preserve original personalities and recognizable outfits.
