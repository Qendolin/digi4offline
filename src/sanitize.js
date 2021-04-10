const zero = /0+%?/g;

/**
 * Fixes:
 * 	 stroke-dasharray values of 0
 * @param {Document} svg
 */
export function sanitizeSvg(svg) {
	const elemets = Array.from(svg.documentElement.getElementsByTagName('*'));
	for (const element of elemets) {
		fixStrokeDashArray(element);
	}
}

/**
 * @param {Element} element
 */
function fixStrokeDashArray(element) {
	if (element.hasAttribute('stroke-dasharray')) {
		debugger;
		const fix = element
			.getAttribute('stroke-dasharray')
			.split(/,?\s*/g)
			.filter((v) => v != '')
			.map((v) => (zero.test(v) ? '1' : v))
			.join(', ');
		element.setAttribute('stroke-dasharray', fix);
	}
	if (element.tagName.toUpperCase() === 'STYLE' && element.firstChild && element.firstChild.nodeValue) {
		debugger;
		/** @type {Text} */
		// @ts-ignore
		const styleText = element.firstChild;
		const fix = styleText.nodeValue.replace(/stroke-dasharray\s*:(.*?)(;|\n)/gi, (
			_,
			/** @type {string} */ value,
			/** @type {string} */ rest
		) => {
			return `stroke-dasharray: ${value
				.split(/,?\s*/g)
				.filter((v) => v != '')
				.map((v) => (zero.test(v) ? '1' : v))
				.join(', ')}${rest}`;
		});
		styleText.nodeValue = fix;
		styleText.data = fix;
	}
}
