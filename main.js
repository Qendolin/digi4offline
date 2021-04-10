import { program } from 'commander';
import read from 'read';
import { Digi4Offline } from './src/d4o.js';

program.requiredOption('-e, --email <address>', 'Your digi4school login email');
program.requiredOption('-b, --book <id>', 'The id of the book you want to download');
program.option('-o, --out <name>', 'Output path, can specify file or folder');
program.option('-p, --password <password>', 'Your digi4school login password (not recommended)');
program.option('-r, --ranges <range>', 'Page ranges, i.e.: 5-10,12,15-', (value) => {
	return value
		.split(',')
		.map((range) => range.split('-'))
		.map(([from, to]) => ({ from: parseInt(from), to: parseInt(to === undefined ? from : to) }));
});
program.option(
	'--dop <degree>',
	'The amount of pages that can be downloaded at the same time',
	(value) => parseInt(value),
	5
);
program.option('--pageRetries', 'How often a page download should be retired', (value) => parseInt(value), 10);
program.option('--imageRetries', 'How often a image download should be retired', (value) => parseInt(value), 10);

program.on('--help', () => {
	console.log('');
	console.log(
		'The password argument is optional. When not provided you will be prompted to input your password into the terminal. This way is recommended because you password will be hidden.'
	);
	console.log('');
	console.log('The book id is part of the url of an open book. (The book must be activated for your account) e.g.:');
	console.log('	for /ebook/5432/1/index.html the id is 5432/1');
	console.log('	for /ebook/3404/ the id is 3404');
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
 * @property {import('./src/book').Range[]} ranges
 * @property {number} dop
 * @property {number} pageRetries
 * @property {number} imageRetries
 */

/**
 * @param {Options} options
 * @param {string} password
 */
async function main(options, password) {
	const d4o = new Digi4Offline(options);
	await d4o.login(options.email, password);
	await d4o.download(options.book, options.out, options.ranges);
}
