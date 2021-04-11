# digi4offline
Download digi4school books as PDF.

```
npm install -g digi4offline
```

# Usage

Run `digi4offline [options]` or `node bin/cli.js [options]`

```
Options:
  -e, --email <address>      Your digi4school login email
  -b, --book <id>            The id of the book you want to download
  -o, --out <name>           Output path, can specify file or folder
  -p, --password <password>  Your digi4school login password (not recommended)
  -r, --ranges <ranges>       Page ranges, i.e.: 5-10,12,15-
  --dop <degree>             The amount of pages that can be downloaded at the same time (default: 5)
  --pageRetries <retries>    How often a page download should be retired (default: 10)
  --imageRetries <retries>   How often a image download should be retired (default: 10)
  -h, --help                 display help for command

The password argument is optional. When not provided you will be prompted to input your password into the terminal. This way is recommended because you password will be hidden.

The book id is part of the url of an open book. (The book must be activated for your account) e.g.:
        for /ebook/5432/1/index.html the id is 5432/1
        for /ebook/3404/ the id is 3404
```

# Setup

1. Download and install node from https://nodejs.org/en/download/
2. Open a terminal
3. Run `npm install -g digi4offline`
4. See Usage