# digi4offline
 Download digi4school books as pdf

# Usage
Run `node index.js [options]`

```
Options:
  -e, --email <address>      Your digi4school login email
  -b, --book <id>            The id of the book you want to download
  -o, --out <name>           Output path, can specify file or folder
  -p, --password <password>  Your digi4school login password (not recommended)
  --from <pageNr>            The page number to start downloading (inclusive) (default: "1")
  --to <pageNr>              The page number to stop downloading (inclusive)
  --dop <degree>             The amount of pages that can be downloaded at the same time (default: "5")
  --faster                   Don't retry downloading images
  -h, --help                 display help for command

The password argument is optional. When not provided you will be prompted to input your password into the terminal. This way is recommended because you password will be hidden.

The book id is part of the url of an open book. (The book must be activated for your account) e.g.:
        for /ebook/5432/1/index.html the id is 5432/1
        for /ebook/3404/ the id is 3404
```