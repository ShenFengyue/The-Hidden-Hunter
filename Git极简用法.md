

# Git极简用法

查看所有commit（简洁版与详细版）

```powershell
git log --oneline
git log
```

查看某次提交修改了什么

```powershell
git show ID
```

查看旧版本（仅查看）以及回来

```powershell
git checkout ID
git checkout main
```

真正让main回到过去，并同步到GitHub（会丢掉后面所有的commit）

```powershell
git reset --hard ID
git push -f
```

撤销某次提交

```powershell
git revert ID
```



---

查看所有历史（包括被删除的分支、回退记录）

```powershell
git reflog
```

