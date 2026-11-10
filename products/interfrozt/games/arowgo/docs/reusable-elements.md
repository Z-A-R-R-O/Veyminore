# Reusable reward elements and Satoshi

## Components

`src/ui/elements/Rewards.tsx` exports:

- `Coin({variant: "hud" | "prize"})`: decorative gold token shared by balance and result.
- `CountUp({value, animate, from?, delay?, prefix?})`: cancellable 850 ms eased number animation. Omit `from` to animate balance changes from the previous value; set it to zero for a reward reveal. Disable animation for reduced motion. The parent supplies the saved balance; this component never changes currency.
- `HeartToken({filled, breaking?})`: full/empty heart plus clipped halves for a newly lost heart. Use a stable slot key and a new loss event to trigger the effect. Reduced motion disables fragments.
- `Encouragement({kind: "welcome" | "win" | "retry"})`: consistent, brief supportive copy.

`src/ui/Icons.tsx` remains the shared SVG icon/heart artwork library. Styles live in `src/ui/style.css`; components require that stylesheet. These are repository-native reusable UI elements, not external image dependencies.

Screen-reader labels expose the actual balance immediately; decorative reward counting is hidden from accessibility announcements. The HUD counter starts at the persisted balance on reload and animates actual changes. Coin reward rules, hearts per attempt and saved best stars remain unchanged. Retry replenishes the existing three-heart attempt, while Practice permits unlimited mistakes.

## Font assets

Satoshi comes from the user-supplied `C:/Users/Lenovo/Downloads/satoshi.zip`. Six original OTF files are saved under `public/fonts/satoshi/`: Regular 400, Medium 500, Bold 700, Black 900, Italic 400 and BlackItalic 900. Local `@font-face` declarations use `font-display: swap` and system sans-serif fallbacks. UI controls inherit the font. No remote font request is made.

The supplied archive contained font files only, with no license document. Preserve provenance and obtain the applicable license text before redistributing these font assets outside this project; no license terms are inferred from the archive.

## Experience

Opening shows a welcoming line without blocking play. A lost heart splits gently over 850 ms. Failure offers an encouraging interpretation and explains that saved earnings remain safe. The retry emblem breathes twice and settles. Winning adds a short good-wish message; no claim of mental-health improvement or guaranteed psychological effect is made. Reduced motion stops these animations. There are no daily penalties or fabricated currency gifts.

## Generated decorative assets

Coin and HeartToken now use the transparent `public/assets/generated/rewards-v1.png` atlas. Animated counts and clipped heart-break fragments remain reusable live components. `GameArt.tsx` selects generated Worlds/Modes/trophy/Story/Hint/Erase artwork from a 3×2 atlas. See [generation prompts and manifest](assets/generated-art.md).
