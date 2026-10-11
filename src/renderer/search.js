(() => {
    const normalize = (value) => String(value ?? "")
        .normalize("NFKD")
        .replace(/[\u064B-\u065F\u0670\u0640]/g, "")
        .replace(/[أإآٱ]/g, "ا")
        .replace(/[ىئ]/g, "ي")
        .replace(/ة/g, "ه")
        .replace(/[٠-٩]/g, (digit) => String(digit.charCodeAt(0) - 0x0660))
        .replace(/[۰-۹]/g, (digit) => String(digit.charCodeAt(0) - 0x06f0))
        .toLocaleLowerCase()
        .replace(/[^\p{L}\p{N}]+/gu, " ")
        .trim();

    const matches = (query, ...values) => {
        const terms = normalize(query).split(/\s+/).filter(Boolean);
        if (!terms.length) return true;

        const searchableText = normalize(values.flat(Infinity).filter((value) => value != null).join(" "));
        return terms.every((term) => searchableText.includes(term));
    };

    window.elSharqSearch = Object.freeze({ normalize, matches });
})();
