/* eslint-env node */

// Simple title scanner for dangerous/horror terms

const STRONG_BAD_TERMS = [
	// Violence / gore
	"gore",
	"gory",
	"blood",
	"bloody",
	"decapitated",
	"beheaded",
	"disemboweled",
	"torture",
	"tortured",
	"torturing",
	"execution",
	"brutal",
	"violent",
	"violence",
	"kill",
	"killing",
	"murder",
	"slaughter",
	"massacre",
	"suicide",
	"self harm",
	"self-harm",
	"hang myself",
	"kill myself",
	"end my life",
	// Horror / monsters
	"horror",
	"terrifying",
	"scary",
	"nightmare",
	"nightmare fuel",
	"creepypasta",
	"creepy",
	"disturbing",
	"cursed",
	"jumpscare",
	"jump scare",
	"killer clown",
	"serial killer",
	"zombie",
	"zombies",
	"demon",
	"demons",
	"possession",
	"exorcism",
	"haunted",
	"poltergeist",
	// Weapons / explicit
	"gun",
	"guns",
	"shooting",
	"school shooting",
	"mass shooting",
	"knife",
	"knives",
	"machete",
	"chainsaw",
	"beheading",
	// NSFW / adult content
	"nsfw",
	"18+",
	"not for kids",
	"not for children",
	"adults only",
	"sex",
	"sexual",
	"porn",
	"nude",
	"naked",
];

/**
 * Scan a video title for dangerous / horror / NSFW terms.
 * Returns an array of reasons if any are found, otherwise [].
 *
 * @param {string} title
 * @returns {string[]}
 */
function scanTitleForDanger(title) {
	if (!title || typeof title !== "string") return [];

	const lower = title.toLowerCase();
	const reasons = [];

	for (const term of STRONG_BAD_TERMS) {
		if (lower.includes(term)) {
			reasons.push(`title contains dangerous term: "${term}"`);
		}
	}

	// If we found multiple strong terms, add a summary
	if (reasons.length >= 2) {
		reasons.push("title strongly suggests horror/gore/violent or adult content");
	}

	return reasons;
}

module.exports = {
	scanTitleForDanger,
};


