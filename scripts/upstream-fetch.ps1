# 拉取 omp-studio 上游快照（只读参考树，不参与构建）。
#
# 示例：
#   powershell -ExecutionPolicy Bypass -File scripts/upstream-fetch.ps1
#   powershell -ExecutionPolicy Bypass -File scripts/upstream-fetch.ps1 -RepoUrl https://ghfast.top/https://github.com/the-snowpear/omp-studio.git
#   powershell -ExecutionPolicy Bypass -File scripts/upstream-fetch.ps1 -Tarball D:\downloads\omp-studio-v0.2.8.tar.gz
#
# 直连 GitHub 被重置时，用 -RepoUrl 指定镜像，或用 -Tarball 指向离线压缩包。

param(
  [string]$RepoUrl = "https://github.com/the-snowpear/omp-studio.git",
  [string]$Tag = "v0.2.8",
  [string]$Commit = "",
  [string]$Tarball = "",
  [string]$Dest = "upstream/omp-studio"
)

$ErrorActionPreference = "Stop"

$root = Resolve-Path (Join-Path $PSScriptRoot "..")
$destPath = Join-Path $root $Dest
$tmp = Join-Path ([System.IO.Path]::GetTempPath()) ("omp-upstream-" + [guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Force -Path $tmp | Out-Null

$sourceRoot = ""
$sourceKind = "git"

try {
  if ($Tarball -ne "") {
    $tarballPath = (Resolve-Path $Tarball).Path
    $sourceKind = "tarball"
    Write-Host "[fetch] 解压离线包 $tarballPath"
    if ($tarballPath -match '\.zip$') {
      Expand-Archive -Path $tarballPath -DestinationPath $tmp -Force
    } else {
      & tar -xzf $tarballPath -C $tmp
      if ($LASTEXITCODE -ne 0) { throw "tar 解压失败" }
    }
    $children = @(Get-ChildItem $tmp -Force | Where-Object { $_.Name -ne "__MACOSX" })
    if ($children.Count -eq 1 -and $children[0].PSIsContainer) {
      $sourceRoot = $children[0].FullName
    } else {
      $sourceRoot = $tmp
    }
  } else {
    $cloneDir = Join-Path $tmp "repo"
    Write-Host "[fetch] 克隆 $RepoUrl（$Tag）"
    & git clone --depth 1 --branch $Tag $RepoUrl $cloneDir
    if ($LASTEXITCODE -ne 0) {
      throw "克隆失败：GitHub 直连可能被重置。请改用 -RepoUrl <镜像地址> 或 -Tarball <本地压缩包>。"
    }
    $sourceRoot = $cloneDir
    if ($Commit -eq "") {
      $Commit = (& git -C $cloneDir rev-parse HEAD).Trim()
    }
  }

  if ($sourceRoot -eq "" -or -not (Test-Path $sourceRoot)) {
    throw "没有找到上游内容"
  }

  New-Item -ItemType Directory -Force -Path $destPath | Out-Null
  Get-ChildItem $destPath -Force | Where-Object { $_.Name -ne "UPSTREAM.json" } | Remove-Item -Recurse -Force
  Get-ChildItem $sourceRoot -Force | Where-Object { $_.Name -ne ".git" } | Copy-Item -Destination $destPath -Recurse -Force

  $version = $Tag
  if ($version.StartsWith("v")) { $version = $version.Substring(1) }

  $meta = [ordered]@{
    project    = "the-snowpear/omp-studio"
    version    = $version
    commit     = $Commit
    fetched_at = (Get-Date).ToUniversalTime().ToString("o")
    source     = $sourceKind
    repo_url   = $RepoUrl
    note       = ""
  }
  $meta | ConvertTo-Json -Depth 4 | Set-Content -Encoding UTF8 (Join-Path $destPath "UPSTREAM.json")

  Write-Host "[fetch] 完成：$destPath（$Tag / $Commit）"
  Write-Host "[fetch] 下一步：node scripts/upstream-triage.mjs"
} finally {
  Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue
}
