# Git Safety Guide - Preventing Force Pushes During Merge Conflicts

## 🚫 Never Force Push During Merge Conflicts

This guide ensures you never accidentally force push code when there are merge conflicts, protecting your codebase and team collaboration.

## 🛡️ Safety Measures in Place

### 1. Pre-Push Hook (`pre-push`)
- **Automatically blocks pushes** if there are uncommitted changes
- **Prevents pushes** when merge conflicts exist
- **Warns about force pushes** and requires confirmation
- **Protects main branches** with additional confirmation

### 2. Git Configuration
- `push.default = simple` - Only pushes current branch to upstream
- `push.autoSetupRemote = false` - Prevents accidental remote creation
- Custom aliases for safer operations

## 🔍 How to Check for Merge Conflicts

### Check Current Status
```bash
git status
```

### List Conflicted Files
```bash
git conflicts  # Custom alias for: git diff --name-only --diff-filter=U
```

### Check for Uncommitted Changes
```bash
git diff --name-only
```

## ✅ Safe Workflow for Merge Conflicts

### 1. When You Encounter a Merge Conflict
```bash
# Check what files are conflicted
git conflicts

# View the conflicts in each file
git diff
```

### 2. Resolve Conflicts
- Open each conflicted file
- Look for conflict markers: `<<<<<<<`, `=======`, `>>>>>>>`
- Edit the file to resolve conflicts
- Remove conflict markers

### 3. After Resolving Conflicts
```bash
# Add resolved files
git add <resolved-files>

# Or add all resolved files
git add .

# Commit the resolution
git commit -m "Resolve merge conflicts"
```

### 4. Safe Push
```bash
# Use the safe push alias
git safe-push

# Or standard push (hook will prevent unsafe operations)
git push
```

## 🚨 What the Pre-Push Hook Prevents

### ❌ Blocked Operations
- Pushing with uncommitted changes
- Pushing with unresolved merge conflicts
- Force pushing without confirmation
- Pushing to protected branches without confirmation

### ⚠️ Operations Requiring Confirmation
- Force pushes (rewriting history)
- Pushing to main/master/develop branches

## 🆘 Emergency Commands

### Abort a Merge
```bash
git abort-merge  # Custom alias for: git merge --abort
```

### Reset to Clean State
```bash
# Reset to last commit (WARNING: loses uncommitted changes)
git reset --hard HEAD

# Reset to remote state (WARNING: loses local changes)
git reset --hard origin/main
```

### Stash Changes Temporarily
```bash
git stash
git stash pop  # To restore later
```

## 🔧 Custom Git Aliases

```bash
# List conflicted files
git conflicts

# Safe push (no force)
git safe-push

# Abort merge
git abort-merge
```

## 📋 Best Practices

1. **Always pull before pushing** to minimize conflicts
2. **Use feature branches** instead of working directly on main
3. **Resolve conflicts immediately** when they occur
4. **Never force push** unless absolutely necessary
5. **Communicate with team** when resolving complex conflicts
6. **Test your code** after resolving conflicts

## 🚀 Feature Branch Workflow

```bash
# Create and switch to feature branch
git checkout -b feature/new-feature

# Make changes and commit
git add .
git commit -m "Add new feature"

# Push feature branch
git push origin feature/new-feature

# Create pull request (don't merge directly)
# Let team review and merge
```

## 🆘 When Things Go Wrong

### If You're Stuck in a Merge
```bash
# Abort the merge
git abort-merge

# Start fresh
git checkout main
git pull origin main
git checkout -b feature/retry-feature
```

### If You Need to Force Push (Emergency Only)
```bash
# The pre-push hook will warn you
# Only proceed if you're absolutely sure
git push --force-with-lease  # Safer than --force
```

## 📞 Getting Help

- Check `git status` for current state
- Use `git conflicts` to see conflicted files
- Review this guide for safe workflows
- Ask team members for help with complex conflicts

---

**Remember: It's always better to take time to resolve conflicts properly than to force push and potentially lose code or cause issues for your team.**
