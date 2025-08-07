import { jsxs, jsx } from 'react/jsx-runtime';
import { useState, useMemo, useCallback, useEffect } from 'react';
import { Grid, ActionPanel } from '@project-gauntlet/api/components';
import { useCachedPromise } from '@project-gauntlet/api/hooks';
import { assetData, Clipboard } from '@project-gauntlet/api/helpers';
import { l as lodashExports } from './vendor.js';

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
 *
 * Ranking (higher weight = higher priority):
 *   5 – exact match on emoji name
 *   4 – exact match on emoji keyword
 *   3 – partial (substring) match on emoji name
 *   2 – partial (substring) match on emoji keyword
 *   1 – partial (substring) match on category/subcategory
 */
class EmojiSearcher {
    emojiList;
    /** root of the suffix‑trie for emoji names */
    nameTrieRoot;
    /** root of the suffix‑trie for keywords */
    keywordTrieRoot;
    /** root of the suffix‑trie for categories/subcategories */
    categoryTrieRoot;
    /** map for exact name lookup (weight 5) */
    nameMap = {};
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
        this.nameTrieRoot = { children: {}, output: [] };
        this.keywordTrieRoot = { children: {}, output: [] };
        this.categoryTrieRoot = { children: {}, output: [] };
        this.buildTries();
    }
    /** Build suffix‑tries for names, keywords, and categories */
    buildTries() {
        const { emojis, keywords, category, subCategory } = this.emojiList;
        // Build name trie and exact name map
        for (let i = 0; i < emojis.length; i++) {
            const emoji = emojis[i];
            const name = emoji[1];
            this.nameMap[name] = i;
            this.insertIntoTrie(this.nameTrieRoot, name.toLowerCase(), i);
        }
        // Build keyword trie
        for (let i = 0; i < emojis.length; i++) {
            const emoji = emojis[i];
            for (const keywordIdx of emoji[4]) {
                const keyword = keywords[keywordIdx];
                this.insertIntoTrie(this.keywordTrieRoot, keyword.toLowerCase(), i);
            }
        }
        // Build category/subcategory trie
        for (let i = 0; i < emojis.length; i++) {
            const emoji = emojis[i];
            const categoryName = category[emoji[2]];
            const subcategoryName = subCategory[emoji[2]][emoji[3]];
            this.insertIntoTrie(this.categoryTrieRoot, categoryName.toLowerCase(), i);
            this.insertIntoTrie(this.categoryTrieRoot, subcategoryName.toLowerCase(), i);
        }
    }
    /** Insert all suffixes of a string into the given trie */
    insertIntoTrie(root, text, emojiIdx) {
        for (let start = 0; start < text.length; start++) {
            let node = root;
            for (let pos = start; pos < text.length; pos++) {
                const ch = text[pos];
                if (!node.children[ch]) {
                    node.children[ch] = { children: {}, output: [] };
                }
                node = node.children[ch];
                if (!node.output.includes(emojiIdx)) {
                    node.output.push(emojiIdx);
                }
            }
        }
    }
    /** Search for a substring in the given trie */
    searchTrie(root, input) {
        let node = root;
        for (let i = 0; i < input.length && node; i++) {
            const ch = input[i];
            node = node.children[ch];
        }
        return node ? node.output : [];
    }
    /**
     * Search emojis by a user supplied string.
     * Uses a voting system where multiple matches accumulate weight.
     * Only returns results with combined weight > 3.
     */
    search(input) {
        const resultVotes = {};
        const lowerInput = input.trim().toLowerCase();
        if (lowerInput === "") {
            return this.emojiList.emojis.map((_, i) => this.intoHumanReadable(i));
        }
        const exactKeywordIdx = this.emojiList.keywords.indexOf(input);
        const addVote = (idx, weight) => {
            resultVotes[idx] = (resultVotes[idx] || 0) + weight;
        };
        // 1. Exact name match (weight 5)
        const exactIdx = this.nameMap[input];
        if (exactIdx !== undefined)
            addVote(exactIdx, 5);
        // 2. Exact keyword match (weight 4)
        if (exactKeywordIdx !== -1) {
            for (let i = 0; i < this.emojiList.emojis.length; i++) {
                const emoji = this.emojiList.emojis[i];
                if (emoji[4].includes(exactKeywordIdx))
                    addVote(i, 4);
            }
        }
        // 3. Partial name match (weight 3)
        const nameMatches = this.searchTrie(this.nameTrieRoot, lowerInput);
        for (const idx of nameMatches) {
            addVote(idx, 3);
        }
        // 4. Partial keyword match (weight 2)
        const keywordMatches = this.searchTrie(this.keywordTrieRoot, lowerInput);
        for (const idx of keywordMatches) {
            addVote(idx, 2);
        }
        // 5. Partial category/subcategory match (weight 1)
        const categoryMatches = this.searchTrie(this.categoryTrieRoot, lowerInput);
        for (const idx of categoryMatches) {
            addVote(idx, 1);
        }
        // Filter results with combined weight > 3 and sort by weight
        return Object.entries(resultVotes)
            .filter(([, weight]) => weight > 3)
            .map(([id, weight]) => this.intoHumanReadable(parseInt(id), weight));
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

async function getEmojiListData() {
    const data = await assetData("reduced-emoji.gz");
    const ds = new DecompressionStream("gzip");
    const blob = new Blob([data]);
    const decompressedStream = blob.stream().pipeThrough(ds);
    const res = await new Response(decompressedStream).text();
    return JSON.parse(res);
}
function useEmojiSearcher() {
    const { data: emojiList } = useCachedPromise(getEmojiListData);
    const searcher = useMemo(() => {
        if (!emojiList)
            return null;
        return new EmojiSearcher(emojiList);
    }, [emojiList]);
    return searcher;
}
const throttledSearch = lodashExports.throttle((input, searcher, update, forceReloadImage) => {
    input = input?.trim();
    if (!input) {
        update(null);
    }
    else {
        const result = searcher.search(input);
        result.sort((a, b) => {
            if (a.weight && b.weight)
                return b.weight - a.weight;
            if (a.weight)
                return -1;
            if (b.weight)
                return 1;
            return a.emoji.localeCompare(b.emoji);
        });
        update(result.slice(0, 32));
    }
    forceReloadImage();
}, 25, {
    leading: false,
    trailing: true,
});
const throttledReload = lodashExports.throttle((reloadFn) => reloadFn(), 50, {
    leading: false,
    trailing: true,
});
/**
 * Force font rendering of emojis for a brief moment to force emoji image reload.
 *
 * This is a workaround, since the image rendering would be incorrect when the
 * search term is empty. (Fallback to rendering common emojis)
 */
function useForceImageReload() {
    const [fontRendering, setFontRendering] = useState(false);
    const forceReloadImage = useCallback(() => throttledReload(() => setFontRendering(true)), []);
    useEffect(() => {
        if (!fontRendering)
            return;
        setFontRendering(false);
    }, [fontRendering]);
    return {
        fontRendering,
        forceReloadImage,
    };
}
function EmojiSelector() {
    const searcher = useEmojiSearcher();
    const [filteredEmoji, setFilteredEmoji] = useState(null);
    const { fontRendering, forceReloadImage } = useForceImageReload();
    const commonEmoji = useMemo(() => searcher?.getCommon() || [], [searcher]);
    const display = filteredEmoji || commonEmoji;
    return (jsxs(Grid, { columns: 8, actions: jsxs(ActionPanel, { children: [jsx(ActionPanel.Action, { label: "Copy to clipboard", onAction: async (emoji) => {
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
                    throttledSearch(v, searcher, setFilteredEmoji, forceReloadImage);
                } }), !searcher && (jsx(Grid.EmptyView, { title: "Hold on tight!", description: "Grabbing all the emojis just for you...", image: { asset: "icon.png" } })), display.map((value) => (jsx(Grid.Item, { id: value.emoji, title: value.name, children: jsx(Grid.Item.Content, { children: jsx(EmojiDisplay, { emoji: value, forceFontRendering: fontRendering }) }) }, value.emoji)))] }));
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
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZW1vamktc2VsZWN0b3IuanMiLCJzb3VyY2VzIjpbXSwic291cmNlc0NvbnRlbnQiOltdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7OzsifQ==
