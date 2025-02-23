# Change Log

<!-- All notable changes to the "search-enhancement" extension will be documented in this file.

Check [Keep a Changelog](http://keepachangelog.com/) for recommendations on how to structure this file. -->

### [0.0.1] - 2024-12-23

- Initial release

### [0.1.0] - 2025-02-16
#### Modify
- 搜尋欄的使用方式，目前可選擇在主要側邊欄或次要側邊欄使用
  - 目前搜尋方式是即打即搜，可在搜尋欄底下的文字得知目前狀態

### [0.1.1] - 2025-02-23
#### Add
- 如Issue #3的需求，搜尋欄增加Partial match mode
#### Improve
- 降低XSS發生的可能

### [0.2.0] - 2025-02-24
#### Add
- github action support: push跟pull request都會編譯並跑過eslint
- 將搜尋的debounce time與.tag路徑改為configurable
#### Update
- Readme.md:
  - 修改Features的文字說明，並更新相關截圖
  - 修改Usage的文字說明，把用法寫得更清楚一點