# GitHub repo setup (when ready)

This project is currently staged at `telegraph/friday-v2/` due to sandboxing. When you’re ready, move it to a dedicated repo folder (e.g. `~/workspace/friday-v2`) and publish.

## Option A: GitHub CLI (recommended)

```sh
mkdir -p ~/workspace/friday-v2
rsync -a --delete ~/workspace/telegraph/friday-v2/ ~/workspace/friday-v2/
cd ~/workspace/friday-v2

git init
git add .
git commit -m "Initial Friday v2 scaffold"

gh repo create oliveredgington/friday-v2 --public --source=. --remote=origin --push
```

## Option B: Manual (no `gh`)

1) Create a new repo on GitHub (e.g. `oliveredgington/friday-v2`)
2) Then:

```sh
mkdir -p ~/workspace/friday-v2
rsync -a --delete ~/workspace/telegraph/friday-v2/ ~/workspace/friday-v2/
cd ~/workspace/friday-v2

git init
git add .
git commit -m "Initial Friday v2 scaffold"
git remote add origin git@github.com:oliveredgington/friday-v2.git
git push -u origin main
```

