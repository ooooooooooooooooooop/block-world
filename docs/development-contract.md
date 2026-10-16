# 长沙连续城市开发契约

目标：按现有PRD补齐可核验景点台账，取得真实全域地理数据，开发连续地理世界、行走、摄影与路人，并用真实浏览器及路网验证。

保持：原PRD不变；九区县范围；真实地理尺度；不以传送/虚构直线代替城区远郊路线；未知坐标和未还原景点明确标记；不声称完整MVP已通过。

允许：当前工作区新增源码、原始公开数据及来源记录、项目级依赖、测试和本地预览。禁止：全局安装、删除用户资料、个人数据访问、购买地图服务、未经验证宣称景点还原通过。

主代理独占：package.json、package-lock.json、index.html、styles.css、src/app.mjs、scripts/*、tests/*、docs/*、data/*、public/*、vendor/*。阶段内可转交数据文件所有权，须明确记录。世界代理独占：src/world.mjs、src/geo.mjs、src/routes.mjs、src/landmarks.mjs；不得改其他文件。数据探查代理只读，项目写入集合为空。

## 引擎接口（世界代理实现）

- ES modules，Three.js通过 `import * as THREE from 'three'` 使用，主页面提供importmap。
- `geo.mjs`导出 `toWorld(lon,lat,origin={lon:113,lat:28.2}) -> {x,z}`、`toGeo(x,z,origin)->{lon,lat}`、`chunkKey(x,z,size=1024)`、`distance(a,b)`。
- `routes.mjs`导出 `buildGraph(graphData)`、`findRoute(graph,startPosition,targetPosition)`，返回 `{points:[{x,y,z}],distance,reachable,reason}`；真实道路图寻路，不补造连接；graphData格式 `{nodes:[[id,x,y,z],...],edges:[[fromId,toId,distance],...]}`，可额外字段，不访问外网。
- `world.mjs`导出异步 `createWorld({canvas,manifest,pois,onState,onNotice})`，返回对象包含 `update(dt,input)`、`render()`、`resize()`、`getState()`、`setTime('day'|'sunset'|'night')`、`setCameraMode('first'|'third')`、`setPhotoMode(enabled,options)`、`capture({width,height,hideNpcs}) -> Promise<Blob>`、`setRoute(route)`、`setAutoWalk(enabled)`、`restore(state)`、`dispose()`。
- input格式 `{forward:number,right:number,run:boolean,jump:boolean,yawDelta:number,pitchDelta:number}`；角度增量为弧度。
- state至少 `{x,y,z,yaw,pitch,distanceWalked,activeChunks,npcCount,nearestPoi,loading,blocked}`；地理位置x/z米。
- manifest格式 `{schemaVersion:1,origin:{lon:113,lat:28.2},chunkSize:1024,bounds:{minX,maxX,minZ,maxZ},start:{x,y,z},chunks:{'ix_iz':'data/chunks/ix_iz.json'},terrain:{...},attribution:[]}`。
- chunk格式 `{key,ix,iz,terrain:{size:1024,resolution:17,heights:[...按z行x列]},roads:[{id,kind,name,width,bridge,points:[[x,y,z],...]}],buildings:[{id,polygon:[[x,z],...],height,name}],water:[{polygon:[[x,z],...]}],landuse:[{kind,polygon:[[x,z],...]}]}`。所有地理坐标是全局米。地面采样与渲染同源，加载完成前不走入空块，分块异步加载缓存有上限；世界原点重定位。
- pois为records数组，记录 `{id,name,district,category,aliases,position:{lon,lat,source,accuracy}|null,world:{x,y,z}|null,model:'... '|null,sourceIds:[],...}`。没有坐标的点不放到地图假位置。

## 本次开发验收

景点数量可追溯原始名录和增量；原始附件保存哈希。真实路网/水系/地形取得后生成本地分块，不把程序噪声当真实地图。角色可以持续跨块前行；城区到远郊通过真实道路寻路，记录覆盖和路网缺口。摄影导出非空PNG，NPC活动，刷新存档恢复。单元验证地理往返/路由/跨块，浏览器验证实际画面和交互。

预算：世界实现代理首次写入前≤6次工具，额外阅读≤4文件，30分钟内提交首个有效实现；不再次委派。任何缺失数据以接口兼容处理，禁止造全市数据。资料代理预算在派工消息中规定。代理每阶段报告有效变化；同一阻塞无新证据最多重试2次，主代理接管诊断。

当前：仅存在PRD，所有实现与数据验收未完成。

## 数据制作阶段所有权转交

数据代理独占：scripts/prepare_pois.py、data/pois.json、data/pois.csv、data/sources.json、docs/景点清单核对.md。只读原始名录 data/raw/hunan-a-scenic-20250225.doc 与PRD/公开官方资料，不改原件、不写世界数据。主代理在代理DONE前不修改这五个文件；DONE后由主代理整合坐标与地图。

## GIS制作阶段所有权转交

世界引擎代理四个src文件已DONE，现这些src文件归主代理集成。新GIS实现任务独占 scripts/extract_region.py、scripts/prepare_data.py、data/world-manifest.json、data/graph.json、data/map.json、data/data-report.json、data/poi-positions.json、data/chunks/*、data/raw/changsha-*.osm.json、data/raw/terrain/*、data/raw/terrain-source.json。不得改pois.json/csv/sources.json（另一代理在写），只生成poi-positions.json供主代理整合。原始湖南PBF由主代理下载，文件 data/raw/hunan-latest.osm.pbf；项目地理依赖在 .python-deps，脚本自行 sys.path.insert(0,str(ROOT/'.python-deps')) 后使用osmium/shapely，PIL/requests在现有Python中可用。参考fetch_world.py的DEM逻辑，可import复用但不能改该文件。

GIS输出严格遵守已有schema：地形同源sample，geo转换常数6371008.8，origin113/28.2，chunkSize1024，DEM分辨率17。manifest.start取真实五一广场或其邻近真实道路/步道并记录来源，不能硬填猜测坐标；所有chunk覆盖真实长沙行政边界，非只做景点走廊。图边采用OSM共享节点ID，不近似拼接无道路的断边；排除禁行/高速/施工道路。桥梁不得贴水面，初期以实际道路几何+DEM做连续高程（标记非测绘精度），坡差不能导致桥梁无法走通。源快照覆盖不等于现实道路百分百完备，数据报告如实披露缺口。

## 景点增量审计阶段

原五个POI文件已交回主代理。数据代理新阶段仅拥有 data/scenic-updates.json、docs/景点增量审计.md，核查2025-02至2026-10-14的长沙相关评级新增、撤销、更名和区县新增3A公告，不能改原始84行或主台账。原始名录口径完整与截至当前有效集合完整分开判断。

## 路由修复所有权

单独路由worker仅拥有src/routes.mjs与tests/routes.test.mjs，主代理在DONE之前不改这两文件。修复真实线段上的出发/终点吸附：投影必须落在现有图边，不补造无道路连接；返回endpoint偏移元数据；保留已有接口与未连通原因。世界和UI仍归主代理，GIS仍归GIS代理。

## 补充定位契约

定位worker仅拥有 scripts/extract_named_pois.py、data/extra-geocodes.json、docs/定位核对.md。读取官方POI台账、已有原始湖南PBF与纯函数normalized，不改主POI和已有地理文件。通过PBF中全部命名node/way匹配明确名称/别名，以弥补地理场景筛选时未保留的命名对象。结果是具有OSM原始ID和坐标的定位候选，仍不等于核实入口；不得通过模糊字符串或猜测城区中心造坐标。主代理负责合并。

## 集成交回与当前验收口径

上述所有子代理写入阶段已 DONE，文件所有权全部交回主代理，子代理没有待收尾写任务。当前交付为首个可玩开发版，原 PRD 的完整全市景点与高还原目标保持不变。

长途验证终点为 OSM 已登记对象的代表点附近道路，不能把代表点等同真实景点入口。靖港路线完成实际连续行走；花明楼/浏阳文庙只有路网与地形覆盖验证，松雅湖断连仍是未通过项。未定位、未核入口和未精制对象不会被计为完整 MVP 验收通过。
