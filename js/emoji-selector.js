import { jsxs, jsx } from 'react/jsx-runtime';
import { useState, useMemo, useEffect } from 'react';
import { Grid, ActionPanel } from '@project-gauntlet/api/components';
import { usePromise } from '@project-gauntlet/api/hooks';
import { assetData, Clipboard } from '@project-gauntlet/api/helpers';
import { F as Fzf, l as lodashExports } from './vendor.js';

const commonEmojis = [
    "😂",
    "❤️",
    "🤣",
    "👍",
    "😭",
    "🙏",
    "😘",
    "🥰",
    "😍",
    "😊",
    "🎉",
    "😁",
    "💕",
    "🥺",
    "😅",
    "🔥",
    "✨",
    "💖",
    "👀",
    "😋",
    "🙂",
    "😳",
    "🥳",
    "😎",
];
/**
 * EmojiSearcher provides fast search over emojis.
 */
class EmojiSearcher {
    emojiList;
    emojiFzf;
    static async createEmoijSearcher() {
        const data = await assetData("reduced-emoji.gz");
        const ds = new DecompressionStream("gzip");
        const blob = new Blob([data]);
        const decompressedStream = blob.stream().pipeThrough(ds);
        const res = await new Response(decompressedStream).text();
        return new EmojiSearcher(JSON.parse(res));
    }
    constructor(emojiList) {
        this.emojiList = emojiList;
        this.emojiFzf = new Fzf(this.buildFuzzySearchEntries(), {
            fuzzy: false,
            selector: (entry) => entry.id,
            tiebreakers: [this.byEmojiSearchType],
        });
    }
    byEmojiSearchType = (a, b) => {
        if (a.item.type === b.item.type)
            return 0;
        if (a.item.type === "name")
            return -1;
        if (b.item.type === "name")
            return 1;
        if (a.item.type === "keyword")
            return -1;
        if (b.item.type === "keyword")
            return 1;
        return 0;
    };
    buildFuzzySearchEntries() {
        const nameEntries = {};
        for (let i = 0; i < this.emojiList.emojis.length; i++) {
            const emoji = this.emojiList.emojis[i];
            const name = emoji[1];
            if (nameEntries[name]) {
                nameEntries[name].index.push(i);
            }
            else {
                nameEntries[name] = { type: "name", index: [i] };
            }
        }
        const keywordEntries = {};
        for (let i = 0; i < this.emojiList.emojis.length; i++) {
            const emoji = this.emojiList.emojis[i];
            for (const keywordIdx of emoji[4]) {
                const keyword = this.emojiList.keywords[keywordIdx];
                if (keywordEntries[keyword]) {
                    keywordEntries[keyword].index.push(i);
                }
                else {
                    keywordEntries[keyword] = { type: "keyword", index: [i] };
                }
            }
        }
        const emojiFuzzySearchEntries = [];
        for (const [id, entry] of Object.entries(nameEntries)) {
            emojiFuzzySearchEntries.push({ id, type: "name", index: entry.index });
        }
        for (const [id, entry] of Object.entries(keywordEntries)) {
            emojiFuzzySearchEntries.push({ id, type: "keyword", index: entry.index });
        }
        return emojiFuzzySearchEntries;
    }
    /**
     * Search emojis by a user supplied string.
     */
    search(input) {
        const results = this.emojiFzf.find(input);
        const resultMap = new Map();
        for (const result of results) {
            for (const id of result.item.index) {
                resultMap.set(id, result);
            }
        }
        const resultUnique = Array.from(resultMap.entries());
        return resultUnique
            .sort((a, b) => {
            const aScore = a[1].score;
            const bScore = b[1].score;
            if (aScore === bScore)
                return a[0] - b[0];
            return bScore - aScore;
        })
            .map(([id, entry]) => this.intoHumanReadable(id, entry.score));
    }
    getAll() {
        return this.emojiList.emojis.map((_, i) => this.intoHumanReadable(i));
    }
    getCommon() {
        return commonEmojis
            .map((e) => {
            const idx = this.emojiList.emojis.findIndex(([emoji]) => emoji === e);
            if (idx === -1)
                return null;
            return this.intoHumanReadable(idx);
        })
            .filter(Boolean);
    }
    /** Convert internal emoji representation to a human‑readable object */
    intoHumanReadable(emojiIdx, weight) {
        const emoji = this.emojiList.emojis[emojiIdx];
        return {
            emoji: emoji[0],
            name: emoji[1],
            category: this.emojiList.category[emoji[2]],
            subcategory: this.emojiList.subCategory[emoji[2]][emoji[3]],
            keywords: emoji[4].map((k) => this.emojiList.keywords[k]),
            image: this.fromEmojiImageArr(emoji[5]),
            weight,
        };
    }
    fromEmojiImageArr(arr) {
        if (!arr)
            return null;
        return {
            image: arr[4],
            apple: arr[0] === 1,
            google: arr[1] === 1,
            twitter: arr[2] === 1,
            facebook: arr[3] === 1,
        };
    }
}

async function readGzippedJson(path) {
    const data = await assetData(path);
    const ds = new DecompressionStream("gzip");
    const blob = new Blob([data]);
    const decompressedStream = blob.stream().pipeThrough(ds);
    const res = await new Response(decompressedStream).text();
    return JSON.parse(res);
}
function readReducedEmojiList() {
    return readGzippedJson("reduced-emoji.gz");
}
function useEmojiSearcher() {
    const { data: emojiList } = usePromise(readReducedEmojiList);
    const searcher = useMemo(() => {
        if (!emojiList)
            return null;
        return new EmojiSearcher(emojiList);
    }, [emojiList]);
    return searcher;
}
const throttledSearch = lodashExports.throttle((input, searcher, update, onFlush) => {
    input = input?.trim();
    if (!input) {
        update(null);
    }
    else {
        update(searcher.search(input).slice(0, 64));
    }
    onFlush();
}, 25, {
    leading: false,
    trailing: true,
});
function EmojiSelector() {
    const searcher = useEmojiSearcher();
    const [filteredEmoji, setFilteredEmoji] = useState(null);
    const [isSearching, setIsSearching] = useState(false);
    const [focusItemId, setFocusItemId] = useState(null);
    const commonEmoji = useMemo(() => searcher?.getCommon() || [], [searcher]);
    const display = filteredEmoji || commonEmoji;
    const focusedEmojiName = display.find((e) => e.emoji === focusItemId)?.name;
    const firstFilteredEmoji = filteredEmoji?.[0]?.emoji;
    useEffect(() => {
        if (isSearching || !firstFilteredEmoji) {
            setFocusItemId(null);
            return;
        }
        setFocusItemId(firstFilteredEmoji);
    }, [isSearching, firstFilteredEmoji]);
    return (jsxs(Grid, { focusedItemId: focusItemId, onItemFocusChange: setFocusItemId, isLoading: !searcher, columns: 8, actions: jsxs(ActionPanel, { children: [jsx(ActionPanel.Action, { label: "Copy to clipboard", onAction: async (emoji) => {
                        if (!emoji)
                            return;
                        await Clipboard.writeText(emoji);
                        return { close: true };
                    } }), jsx(ActionPanel.Action, { label: "Copy image to clipboard", onAction: async (emoji) => {
                        if (!emoji)
                            return;
                        const emojiData = display.find((e) => e.emoji === emoji);
                        const emojiPath = emojiData && getImagePath(emojiData);
                        if (emojiPath) {
                            await Clipboard.write({
                                "image/png": await assetData(emojiPath),
                            });
                        }
                        else {
                            await Clipboard.writeText(emoji);
                        }
                        return { close: true };
                    } })] }), children: [jsx(Grid.SearchBar, { placeholder: "Search for emoji...", onChange: (v) => {
                    if (!searcher)
                        return;
                    setIsSearching(true);
                    throttledSearch(v, searcher, setFilteredEmoji, () => setIsSearching(false));
                } }), !searcher && (jsx(Grid.EmptyView, { title: "Hold on tight!", description: "Grabbing all the emojis just for you...", image: { asset: "icon.png" } })), jsxs(Grid.Section, { title: focusedEmojiName ?? "", columns: 8, children: [isSearching &&
                        new Array(24).fill(null).map((_, i) => (jsx(Grid.Item, { id: `placeholder-${i}`, children: jsx(Grid.Item.Content, { children: jsx(Grid.Item.Content.H1, {}) }) }, i))), !isSearching &&
                        display.map((value) => (jsx(Grid.Item, { id: value.emoji, title: value.name, children: jsx(Grid.Item.Content, { children: jsx(EmojiDisplay, { emoji: value }) }) }, value.emoji)))] })] }));
}
function getImagePath(emoji) {
    if (!emoji.image)
        return null;
    if (Deno.build.os === "darwin" && emoji.image.apple) {
        return `img-apple-64/${emoji.image.image}`;
    }
    if (emoji.image.google) {
        return `img-google-64/${emoji.image.image}`;
    }
    return null;
}
function EmojiDisplay({ emoji, forceFontRendering, }) {
    const imgPath = getImagePath(emoji);
    if (!imgPath || forceFontRendering)
        return jsx(Grid.Item.Content.H1, { children: emoji.emoji });
    return jsx(Grid.Item.Content.Image, { source: { asset: imgPath } });
}

export { EmojiSelector as default };
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZW1vamktc2VsZWN0b3IuanMiLCJzb3VyY2VzIjpbXSwic291cmNlc0NvbnRlbnQiOltdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7OzsifQ==
