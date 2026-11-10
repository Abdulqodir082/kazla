/* Kazla card artwork: classical Russian-style deck drawn in SVG.
 * Corner indices use the Russian letters Т (туз), К (король), Д (дама), В (валет).
 * Exposes window.KazlaCards = { svg(card), sprite(), RU } */
(function () {
  "use strict";
  const RU = { A: "Т", K: "К", Q: "Д", J: "В", "10": "10", "9": "9", "8": "8", "7": "7", "6": "6" };
  const SUIT_ID = { "♠": "s", "♥": "h", "♦": "d", "♣": "c" };
  const RED_INK = "#b3121f", BLACK_INK = "#17120e";
  const GOLD = "#c9a227", GOLD_D = "#8a6a12", BLUE = "#1f3b7a", GREEN = "#2f6b3a", SKIN = "#f2d6b3";

  /* Suit pips drawn in a 100×100 box */
  const PIPS = {
    h: '<path d="M50 90C22 68 5 52 5 31 5 15 16 6 29 6c9 0 16 5 21 14C55 11 62 6 71 6c13 0 24 9 24 25 0 21-17 37-45 59z"/>',
    d: '<path d="M50 3Q63 27 86 50 63 73 50 97 37 73 14 50 37 27 50 3z"/>',
    s: '<path d="M50 4c13 19 44 34 44 57 0 13-10 21-22 21-8 0-15-4-19-11 1 10 5 18 14 23H33c9-5 13-13 14-23-4 7-11 11-19 11C16 82 6 74 6 61 6 38 37 23 50 4z"/>',
    c: '<circle cx="50" cy="27" r="20"/><circle cx="27" cy="57" r="20"/><circle cx="73" cy="57" r="20"/><path d="M45 52c0 20-5 32-14 42h38c-9-10-14-22-14-42z"/>'
  };

  /* The sprite holds the pips and the court figures once; cards reference them with <use>. */
  function sprite() {
    const pip = k => `<symbol id="kz-p${k}" viewBox="0 0 100 100">${PIPS[k]}</symbol>`;
    // Court half-figures live in a 200×112 box (the top half of the card frame)
    const robeTrim = `stroke="${GOLD_D}" stroke-width="1.5"`;
    const king = `
      <path d="M40 112L50 84Q100 66 150 84L160 112Z" fill="var(--robe)" ${robeTrim}/>
      <path d="M58 82Q100 70 142 82L140 92Q100 81 60 92Z" fill="#fbf7ee" stroke="${GOLD_D}" stroke-width="1"/>
      <g fill="#17120e"><circle cx="72" cy="85" r="1.6"/><circle cx="88" cy="83" r="1.6"/><circle cx="112" cy="83" r="1.6"/><circle cx="128" cy="85" r="1.6"/></g>
      <path d="M100 84V112" stroke="${GOLD}" stroke-width="3"/>
      <path d="M84 50Q82 40 86 34L114 34Q118 40 116 50" fill="#6b4a2b"/>
      <ellipse cx="100" cy="52" rx="15" ry="18" fill="${SKIN}" stroke="#b08a63" stroke-width="1"/>
      <path d="M85 56Q100 98 115 56Q108 66 100 66Q92 66 85 56Z" fill="#8a6b4e"/>
      <path d="M92 62Q100 58 108 62" stroke="#5a412c" stroke-width="2" fill="none"/>
      <circle cx="94" cy="50" r="1.7" fill="#2a1b10"/><circle cx="106" cy="50" r="1.7" fill="#2a1b10"/>
      <path d="M82 36L83 18L91 28L100 12L109 28L117 18L118 36Z" fill="${GOLD}" stroke="${GOLD_D}" stroke-width="1.5"/>
      <rect x="82" y="33" width="36" height="6" fill="var(--trim)" stroke="${GOLD_D}" stroke-width="1"/>
      <circle cx="100" cy="24" r="2.5" fill="#b3121f"/>
      <path d="M150 112L156 40" stroke="${GOLD}" stroke-width="4" stroke-linecap="round"/>
      <circle cx="156" cy="36" r="7" fill="${GOLD}" stroke="${GOLD_D}" stroke-width="1.5"/>
      <path d="M156 29V22M152 25H160" stroke="${GOLD_D}" stroke-width="2"/>`;
    const queen = `
      <path d="M44 112L54 86Q100 70 146 86L156 112Z" fill="var(--robe)" ${robeTrim}/>
      <path d="M70 84Q100 100 130 84" stroke="${GOLD}" stroke-width="3" fill="none"/>
      <g fill="${GOLD}"><circle cx="80" cy="92" r="2.4"/><circle cx="100" cy="96" r="2.4"/><circle cx="120" cy="92" r="2.4"/></g>
      <path d="M84 52Q80 74 76 92L88 88Q86 70 88 56Z" fill="#5b3a22"/>
      <path d="M116 52Q120 74 124 92L112 88Q114 70 112 56Z" fill="#5b3a22"/>
      <ellipse cx="100" cy="56" rx="14" ry="17" fill="${SKIN}" stroke="#b08a63" stroke-width="1"/>
      <circle cx="94" cy="55" r="1.6" fill="#2a1b10"/><circle cx="106" cy="55" r="1.6" fill="#2a1b10"/>
      <path d="M96 64Q100 66 104 64" stroke="#a3333a" stroke-width="2" fill="none"/>
      <path d="M76 46Q100 -2 124 46Q100 36 76 46Z" fill="var(--trim)" stroke="${GOLD_D}" stroke-width="1.5"/>
      <path d="M80 44Q100 6 120 44" stroke="${GOLD}" stroke-width="2" fill="none"/>
      <g fill="#fbf7ee" stroke="${GOLD_D}" stroke-width=".6"><circle cx="84" cy="34" r="2.2"/><circle cx="91" cy="24" r="2.2"/><circle cx="100" cy="20" r="2.4"/><circle cx="109" cy="24" r="2.2"/><circle cx="116" cy="34" r="2.2"/></g>
      <path d="M48 112Q44 92 52 80" stroke="${GREEN}" stroke-width="3" fill="none"/>
      <circle cx="53" cy="76" r="6" fill="#b3121f"/><circle cx="53" cy="76" r="2.4" fill="${GOLD}"/>`;
    const jack = `
      <path d="M46 112L56 86Q100 72 144 86L154 112Z" fill="var(--robe)" ${robeTrim}/>
      <path d="M100 82V112M84 86L100 98L116 86" stroke="${GOLD}" stroke-width="2.5" fill="none"/>
      <g fill="${GOLD}"><circle cx="100" cy="104" r="2"/></g>
      <path d="M86 50Q86 66 92 70L108 70Q114 66 114 50" fill="#7a5233"/>
      <ellipse cx="100" cy="56" rx="14" ry="17" fill="${SKIN}" stroke="#b08a63" stroke-width="1"/>
      <circle cx="94" cy="54" r="1.6" fill="#2a1b10"/><circle cx="106" cy="54" r="1.6" fill="#2a1b10"/>
      <path d="M92 63Q100 60 108 63" stroke="#5a412c" stroke-width="2.2" fill="none"/>
      <path d="M80 44Q100 18 120 44Z" fill="var(--trim)" stroke="${GOLD_D}" stroke-width="1.5"/>
      <rect x="80" y="41" width="40" height="6" rx="2" fill="${GOLD}" stroke="${GOLD_D}" stroke-width="1"/>
      <path d="M118 40Q140 20 132 6Q128 22 114 32" fill="#fbf7ee" stroke="${GOLD_D}" stroke-width="1"/>
      <path d="M48 112L48 30" stroke="#6b4a2b" stroke-width="3.5"/>
      <path d="M48 30L40 44L48 40L56 44Z" fill="#9aa4ad" stroke="#4b5560" stroke-width="1"/>`;
    const fig = (id, body) => `<symbol id="kz-${id}" viewBox="0 0 200 112">${body}</symbol>`;
    return `<svg xmlns="http://www.w3.org/2000/svg" width="0" height="0" style="position:absolute" aria-hidden="true"><defs>
      ${pip("h")}${pip("d")}${pip("s")}${pip("c")}
      ${fig("K", king)}${fig("Q", queen)}${fig("J", jack)}
    </defs></svg>`;
  }

  const P = (k, x, y, size, ink, flip) =>
    `<use href="#kz-p${k}" x="${x - size / 2}" y="${y - size / 2}" width="${size}" height="${size}" fill="${ink}"${flip ? ` transform="rotate(180 ${x} ${y})"` : ""}/>`;

  const LAYOUT = {
    "6": [[70, 66], [130, 66], [70, 140], [130, 140], [70, 214], [130, 214]],
    "7": [[70, 66], [130, 66], [100, 103], [70, 140], [130, 140], [70, 214], [130, 214]],
    "8": [[70, 66], [130, 66], [100, 103], [70, 140], [130, 140], [100, 177], [70, 214], [130, 214]],
    "9": [[70, 62], [130, 62], [70, 114], [130, 114], [100, 140], [70, 166], [130, 166], [70, 218], [130, 218]],
    "10": [[70, 62], [130, 62], [100, 88], [70, 114], [130, 114], [70, 166], [130, 166], [100, 192], [70, 218], [130, 218]]
  };

  // Robe / trim colours per court rank, varied by suit like a printed deck
  const COURT = {
    K: { h: [RED_INK, BLUE], d: [BLUE, RED_INK], s: [BLUE, GREEN], c: [GREEN, RED_INK] },
    Q: { h: [BLUE, RED_INK], d: [RED_INK, GREEN], s: [GREEN, BLUE], c: [RED_INK, BLUE] },
    J: { h: [GREEN, RED_INK], d: [BLUE, GREEN], s: [RED_INK, BLUE], c: [BLUE, RED_INK] }
  };

  function corner(r, k, ink) {
    const t = RU[r];
    const fs = t.length > 1 ? 38 : 44;
    return `<g fill="${ink}"><text x="25" y="46" text-anchor="middle" font-family="'PT Serif', Georgia, serif" font-weight="700" font-size="${fs}" ${t.length > 1 ? 'letter-spacing="-3"' : ""}>${t}</text></g>${P(k, 25, 68, 26, ink)}`;
  }

  function svg(card) {
    const s = card.slice(-1), r = card.slice(0, -1), k = SUIT_ID[s];
    const ink = (k === "h" || k === "d") ? RED_INK : BLACK_INK;
    let art = "";
    if (LAYOUT[r]) {
      art = LAYOUT[r].map(([x, y]) => P(k, x, y, 36, ink, y > 140)).join("");
    } else if (r === "A") {
      art = `<ellipse cx="100" cy="140" rx="58" ry="78" fill="none" stroke="${GOLD}" stroke-width="3"/>
        <ellipse cx="100" cy="140" rx="51" ry="71" fill="#fffaf0" stroke="${GOLD_D}" stroke-width="1"/>
        <g fill="${GOLD}">
          <path d="M100 56q8 8 0 16q-8-8 0-16zM100 208q8 8 0 16q-8-8 0-16z"/>
          <path d="M36 140q8-8 16 0q-8 8-16 0zM148 140q8-8 16 0q-8 8-16 0z"/>
        </g>
        <g fill="none" stroke="${GOLD_D}" stroke-width="1.2">
          <path d="M62 84q-14 8-10 24M138 84q14 8 10 24M62 196q-14-8-10-24M138 196q14-8 10-24"/>
        </g>
        ${P(k, 100, 140, 74, ink)}`;
    } else {
      const [robe, trim] = COURT[r][k];
      art = `<g style="--robe:${robe};--trim:${trim}">
        <rect x="46" y="30" width="108" height="220" rx="6" fill="#fffaf0" stroke="${ink}" stroke-width="2"/>
        <rect x="50" y="34" width="100" height="212" rx="4" fill="none" stroke="${GOLD}" stroke-width="1.5"/>
        <svg x="50" y="34" width="100" height="106" viewBox="36 4 128 108" preserveAspectRatio="xMidYMax meet"><use href="#kz-${r}" width="200" height="112"/></svg>
        <g transform="rotate(180 100 140)"><svg x="50" y="34" width="100" height="106" viewBox="36 4 128 108" preserveAspectRatio="xMidYMax meet"><use href="#kz-${r}" width="200" height="112"/></svg></g>
        <path d="M50 140H150" stroke="${GOLD}" stroke-width="2"/>
        ${P(k, 62, 48, 18, ink)}${P(k, 138, 232, 18, ink, true)}
      </g>`;
    }
    return `<svg class="kz-art" viewBox="0 0 200 280" aria-hidden="true">
      <rect x="1.5" y="1.5" width="197" height="277" rx="14" fill="#fbf6ea" stroke="#cfc3a8" stroke-width="3"/>
      <rect x="9" y="9" width="182" height="262" rx="9" fill="none" stroke="${ink}" stroke-opacity=".18" stroke-width="1.5"/>
      ${art}
      ${corner(r, k, ink)}
      <g transform="rotate(180 100 140)">${corner(r, k, ink)}</g>
    </svg>`;
  }

  /* Classic red patterned back, as a CSS background */
  const BACK = "data:image/svg+xml," + encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24">
      <rect width="24" height="24" fill="#8e1b22"/>
      <path d="M12 0L24 12L12 24L0 12Z" fill="none" stroke="#e8c97a" stroke-width="1" stroke-opacity=".75"/>
      <circle cx="12" cy="12" r="3" fill="none" stroke="#e8c97a" stroke-width=".8" stroke-opacity=".8"/>
      <circle cx="12" cy="12" r="1" fill="#f6e7c1"/>
      <circle cx="0" cy="0" r="1.6" fill="#e8c97a" fill-opacity=".7"/><circle cx="24" cy="0" r="1.6" fill="#e8c97a" fill-opacity=".7"/>
      <circle cx="0" cy="24" r="1.6" fill="#e8c97a" fill-opacity=".7"/><circle cx="24" cy="24" r="1.6" fill="#e8c97a" fill-opacity=".7"/>
    </svg>`);

  window.KazlaCards = { svg, sprite, RU, BACK };
})();
