import { program } from 'commander';
import read from 'read';
import { Digi4Offline } from './src/d4o.js';

program.requiredOption('-e, --email <address>', 'Your digi4school login email');
program.requiredOption('-b, --book <id>', 'The id of the book you want to download');
program.option('-o, --out <name>', 'Output path, can specify file or folder');
program.option('-p, --password <password>', 'Your digi4school login password (not recommended)');
program.option('-r, --ranges <ranges>', 'Page ranges, i.e.: 5-10,12,15-', (value) => {
	return value
		.split(',')
		.map((range) => range.split('-'))
		.map(([from, to]) => ({ from: from, to: to === undefined ? from : to }));
});
program.option(
	'--dop <degree>',
	'The amount of pages that can be downloaded at the same time',
	(value) => parseInt(value),
	5
);
program.option(
	'--pageRetries <retries>',
	'How often a page download should be retired',
	(value) => parseInt(value),
	10
);
program.option(
	'--imageRetries <retries>',
	'How often a image download should be retired',
	(value) => parseInt(value),
	10
);
program.option('-l, --labels', 'Use page labels instead of indices for ranges');

program.on('--help', () => {
	console.log('');
	console.log(
		'The password argument is optional. When not provided you will be prompted to input your password into the terminal. This way is recommended because you password will be hidden.'
	);
	console.log('');
	console.log('The book id is part of the url of an open book. (The book must be activated for your account) e.g.:');
	console.log('	for /ebook/5432/1/index.html the id is 5432/1');
	console.log('	for /ebook/3404/ the id is 3404');
	console.log(
		'This only works for books that are directly hosted on digi4school.at, for other domains go to your bookshelf (https://digi4school.at/ebooks), right-click the book that you want to download, and select "Copy link address". Use it as the book id.'
	);
});

program.parse(process.argv);

const options = program.opts();

options.ranges = options.ranges || [{ from: NaN, to: NaN }];
let password = options.password;
delete options.password;
if (!password) {
	read({ prompt: 'Password? ', silent: true }, (error, password) => {
		if (error) return;

		// @ts-ignore
		main(options, password).catch((err) => console.error(err));
	});
} else {
	// @ts-ignore
	main(options, password).catch((err) => console.error(err));
}

/**
 * @typedef Options
 * @property {string} email
 * @property {string} book
 * @property {string} out
 * @property {import('./src/util').PageRange[]} ranges
 * @property {number} dop
 * @property {number} pageRetries
 * @property {number} imageRetries
 * @property {boolean} labels
 */

/**
 * @param {Options} options
 * @param {string} password
 */
async function main(options, password) {
	const d4o = new Digi4Offline(options);
	await d4o.login(options.email, password);

	if (!d4o.validateBookIdOrUrl(options.book)) {
		throw new Error("invalid 'book' option format");
	}

	await d4o.download(options.book, options.out, options.ranges);
}
