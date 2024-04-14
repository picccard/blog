# Setup
```bash
brew install hugo

mkdir blog
cd blog
git init

# 
hugo new site . --force

# add theme
git submodule add --depth=1 https://github.com/canhtran/maverick.git themes/maverick

# update theme
git submodule update --remote --merge

# use example site from theme
cp -r themes/maverick/exampleSite/* .
```

# Ref
- [https://gohugo.io/getting-started/quick-start/](https://gohugo.io/getting-started/quick-start/)
- [https://themes.gohugo.io/themes/maverick/](https://themes.gohugo.io/themes/maverick/)
- [https://themes.gohugo.io/themes/gokarna/](https://themes.gohugo.io/themes/gokarna/)