import { useState } from "react";
import { Sheet } from "./Sheet";

const CATEGORIES: [label: string, icon: string, emoji: string][] = [
  ["Smileys", "😀", "😀 😃 😄 😁 😆 😅 🤣 😂 🙂 🙃 😉 😊 😇 🥰 😍 🤩 😘 😗 😚 😋 😛 😜 🤪 😝 🤑 🤗 🤭 🤫 🤔 🤐 🤨 😐 😑 😶 😏 😒 🙄 😬 😮‍💨 🤥 😌 😔 😪 🤤 😴 😷 🤒 🤕 🤢 🤮 🥵 🥶 🥴 😵 🤯 🤠 🥳 🥸 😎 🤓 🧐 😕 😟 🙁 😮 😯 😲 😳 🥺 🥹 😦 😧 😨 😰 😥 😢 😭 😱 😖 😣 😞 😓 😩 😫 🥱 😤 😡 😠 🤬 😈 👿 💀 ☠️ 💩 🤡 👹 👺 👻 👽 🤖 😺 😸 😹 😻 😼 😽 🙀 😿 😾"],
  ["People", "👍", "👍 👎 👏 🙌 👐 🤲 🙏 🤝 👊 ✊ 🤛 🤜 🤞 ✌️ 🤟 🤘 👌 🤌 🤏 👈 👉 👆 👇 ☝️ ✋ 🤚 🖐️ 🖖 👋 🤙 💪 🦾 🖕 ✍️ 🤳 💅 👀 👁️ 👅 👄 🧠 🫶 🫡 🫠 🫢 🫣 🙈 🙉 🙊 💁 🙋 🙇 🤦 🤷 🧑‍💻 🧑‍🍳 🧑‍🚀 🥷 🦸 🧙 🧛 🧟 💃 🕺 👯 🏃 🚶 🧘"],
  ["Hearts", "❤️", "❤️ 🧡 💛 💚 💙 💜 🖤 🤍 🤎 💔 ❤️‍🔥 ❤️‍🩹 💕 💞 💓 💗 💖 💘 💝 💟 💌 💋 💯 💢 💥 💫 💦 💨 🕳️ 💬 💭 💤 ✨ 🔥 ⭐ 🌟 ⚡ 🌈"],
  ["Animals", "🐶", "🐶 🐱 🐭 🐹 🐰 🦊 🐻 🐼 🐨 🐯 🦁 🐮 🐷 🐸 🐵 🐔 🐧 🐦 🐤 🦆 🦅 🦉 🦇 🐺 🐗 🐴 🦄 🐝 🐛 🦋 🐌 🐞 🐜 🕷️ 🐢 🐍 🦎 🦖 🦕 🐙 🦑 🦐 🦀 🐡 🐠 🐟 🐬 🐳 🐋 🦈 🐊 🐅 🐆 🦓 🦍 🐘 🦛 🦏 🐪 🦒 🦘 🐃 🐄 🐎 🐖 🐑 🐐 🦌 🐕 🐈 🐓 🦃 🦚 🦜 🦢 🐇 🦝 🦨 🦡 🦦 🦥 🐁 🐿️ 🦔 🌵 🌲 🌳 🌴 🌱 🌿 🍀 🍁 🍂 🌸 🌺 🌻 🌹 🌷 🌼 🍄 🌎 🌙 ☀️ ⛅ 🌧️ ⛈️ ❄️ ☃️ 🌊"],
  ["Food", "🍕", "🍏 🍎 🍐 🍊 🍋 🍌 🍉 🍇 🍓 🫐 🍒 🍑 🥭 🍍 🥥 🥝 🍅 🥑 🍆 🥔 🥕 🌽 🌶️ 🥒 🥬 🥦 🧄 🧅 🥜 🍞 🥐 🥖 🥨 🥯 🥞 🧇 🧀 🍖 🍗 🥩 🥓 🍔 🍟 🍕 🌭 🥪 🌮 🌯 🥗 🍝 🍜 🍲 🍛 🍣 🍱 🥟 🍤 🍙 🍚 🍘 🍥 🍦 🍧 🍨 🍩 🍪 🎂 🍰 🧁 🥧 🍫 🍬 🍭 🍮 🍯 🍼 ☕ 🍵 🧃 🥤 🧋 🍺 🍻 🥂 🍷 🥃 🍸 🍹 🧉 🍾 🧊"],
  ["Activity", "⚽", "⚽ 🏀 🏈 ⚾ 🥎 🎾 🏐 🏉 🥏 🎱 🏓 🏸 🏒 🏑 🥍 🏏 ⛳ 🏹 🎣 🥊 🥋 🛹 ⛸️ 🎿 🏂 🏋️ 🤼 🤸 🏆 🥇 🥈 🥉 🏅 🎖️ 🎗️ 🎫 🎟️ 🎪 🎭 🎨 🎬 🎤 🎧 🎼 🎹 🥁 🎷 🎺 🎸 🪕 🎻 🎲 ♟️ 🎯 🎳 🎮 🕹️ 🧩 🎉 🎊 🎈 🎁 🎀 🪅 🎃 🎄 🎆 🎇"],
  ["Travel", "🚗", "🚗 🚕 🚙 🚌 🏎️ 🚓 🚑 🚒 🚚 🚜 🛵 🏍️ 🚲 🛴 🚨 🚔 🚍 🚘 🚖 ✈️ 🛫 🛬 🚀 🛸 🚁 ⛵ 🚤 🛳️ ⚓ 🚧 ⛽ 🚦 🗺️ 🗿 🗽 🗼 🏰 🏯 🏟️ 🎡 🎢 🎠 ⛲ 🏖️ 🏝️ 🏜️ 🌋 ⛰️ 🏔️ 🗻 🏕️ ⛺ 🏠 🏡 🏘️ 🏢 🏬 🏥 🏦 🏨 🏫 ⛪ 🕌 🛕 🕍 🌆 🌃 🌉 🌌"],
  ["Objects", "💡", "⌚ 📱 💻 ⌨️ 🖥️ 🖨️ 🖱️ 💾 💿 📷 📸 📹 🎥 📺 📻 🎙️ ⏰ ⏳ 📡 🔋 🔌 💡 🔦 🕯️ 💸 💵 💰 💳 💎 ⚖️ 🔧 🔨 ⚒️ 🛠️ ⛏️ 🔩 ⚙️ 🧲 🔫 💣 🔪 🗡️ ⚔️ 🛡️ 🔮 🧿 💈 🔭 🔬 💊 💉 🩹 🧬 🧪 🌡️ 🧹 🧺 🧻 🚽 🛁 🔑 🗝️ 🚪 🛋️ 🛏️ 🧸 🖼️ 🛍️ 🛒 🎁 ✉️ 📦 📫 📝 📁 📅 📌 📎 ✂️ 🔒 🔓 📚 📖 🔖 🔗"],
  ["Symbols", "✅", "✅ ☑️ ✔️ ❌ ❎ ➕ ➖ ➗ ✖️ ♾️ ‼️ ⁉️ ❓ ❔ ❕ ❗ 〰️ ⚠️ 🚸 ⛔ 🚫 🔞 📵 🚭 ♻️ 🔰 ⚜️ 🔱 📛 ⭕ 🆗 🆒 🆕 🆓 🆙 🆘 🔝 🔜 🔙 🔚 🔛 ▶️ ⏸️ ⏹️ ⏺️ ⏭️ ⏮️ ⏩ ⏪ 🔀 🔁 🔂 ◀️ 🔼 🔽 ➡️ ⬅️ ⬆️ ⬇️ ↗️ ↘️ ↙️ ↖️ ↕️ ↔️ 🔄 🎵 🎶 💲 ©️ ®️ ™️ 🔴 🟠 🟡 🟢 🔵 🟣 ⚫ ⚪ 🟥 🟧 🟨 🟩 🟦 🟪 ⬛ ⬜ 🔶 🔷 🏁 🚩 🏳️ 🏴 🏳️‍🌈 🏳️‍⚧️ 🏴‍☠️ 🇺🇸 🇬🇧 🇨🇦 🇲🇽 🇯🇵 🇰🇷 🇩🇪 🇫🇷 🇪🇸 🇮🇹 🇧🇷 🇮🇳 🇦🇺"],
];

export const QUICK_REACTIONS = ["👍", "❤️", "😂", "😮", "😢", "🔥"];

type Props = { title: string; onPick: (emoji: string) => void; onClose: () => void; keepOpen?: boolean };

export function EmojiPicker({ title, onPick, onClose, keepOpen }: Props) {
  const [tab, setTab] = useState(0);
  const list = CATEGORIES[tab][2].split(" ");
  return (
    <Sheet title={title} onClose={onClose}>
      <div className="flex gap-1 overflow-x-auto pb-2 -mx-1 px-1" role="tablist" aria-label="Emoji categories">
        {CATEGORIES.map(([label, icon], i) => (
          <button
            key={label}
            role="tab"
            aria-selected={tab === i}
            aria-label={label}
            title={label}
            className={`chip flex-none text-xl leading-none px-2.5 py-1.5 ${tab === i ? "on" : ""}`}
            onClick={() => setTab(i)}
          >
            {icon}
          </button>
        ))}
      </div>
      <div className="grid grid-cols-8 sm:grid-cols-10 gap-0.5 overflow-y-auto max-h-[42dvh]" role="tabpanel">
        {list.map((e) => (
          <button
            key={e}
            className="aspect-square text-2xl grid place-items-center hover:bg-panel-2 active:bg-panel-2 focus-visible:outline-2 focus-visible:outline-focus"
            onClick={() => { onPick(e); if (!keepOpen) onClose(); }}
            aria-label={e}
          >
            {e}
          </button>
        ))}
      </div>
    </Sheet>
  );
}
