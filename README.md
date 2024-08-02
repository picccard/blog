# Setup

## Initialize site
```bash
brew install hugo

mkdir blog
cd blog
git init

hugo new site . --force
```

## Adding themes
```bash
git submodule add --depth=1 https://github.com/canhtran/maverick.git themes/maverick
git submodule add --depth=1 https://github.com/526avijitgupta/gokarna.git themes/gokarna

# update theme
git submodule update --remote --merge

# use example site from theme
cp -r themes/maverick/exampleSite/* .
```

## Adding notice boxes
```bash
git submodule add https://github.com/martignoni/hugo-notice.git themes/hugo-notice
```
Add hugo-notice as the left-most element of the theme list in `hugo.toml`.
``` toml
theme = ["hugo-notice", "my-theme"]
```
# Ref
- [https://gohugo.io/getting-started/quick-start/](https://gohugo.io/getting-started/quick-start/)
- [https://themes.gohugo.io/themes/maverick/](https://themes.gohugo.io/themes/maverick/)
- [https://themes.gohugo.io/themes/gokarna/](https://themes.gohugo.io/themes/gokarna/)
- [https://github.com/martignoni/hugo-notice](https://github.com/martignoni/hugo-notice)
