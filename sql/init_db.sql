-- ============================================================================
--  易校圈（Project-YXX）核心库初始化脚本  sql/init_db.sql
-- ----------------------------------------------------------------------------
--  目标库    : MySQL 8.0.16+（CHECK 约束自此版本起强制生效）
--  依据文档  : 易校圈_Project-YXX_商业级项目计划书_V1.0.0.md
--              第六章 6.1 数据分层与命名规范 / 6.2 实体关系图
--                     6.3 核心表结构（6.3.1 ~ 6.3.4）/ 6.4 索引与性能设计
--                     6.5 数据安全设计
--  覆盖范围  : sys_user、biz_item、biz_order、sys_credit_log（共 4 张表）
--  字符集    : utf8mb4 / utf8mb4_0900_ai_ci（MySQL 8.0 默认，支持中文与 emoji）
--  时间口径  : 全库 UTC 存储（6.1）。脚本首行 SET time_zone='+00:00'，
--              连接池必须设置相同 session 时区，否则 CURRENT_TIMESTAMP 会写入本地时间。
--  主键口径  : 6.1「主键统一 BIGINT AUTO_INCREMENT」，故 4 张表主键均为 BIGINT 自增
--              （6.3.4 的 id 未标注 Auto_Inc，按 6.1 通用约定补全，见决策 D-05）。
-- ============================================================================
--
--  【架构决策记录】——与文档存在张力或文档留白之处，逐条在此显式说明
--
--  D-01 student_no 唯一性：6.3.1 的「约束」列标注 student_no UNIQUE，但同节
--       「设计说明」与 6.4 索引表均要求不加密文字段建索引（避免索引泄露且密文
--       查询无意义）。故本脚本仅在 student_no_hash 上建唯一键 uk_student_no_hash，
--       把 student_no 的 UNIQUE 以注释形式保留（见文件末尾附录 A）。
--  D-02 student_no 列宽：6.3.1 定义 VARCHAR(20)，但 AES-256-GCM 密文（Base64 的
--       IV+Tag+Ciphertext）约 64~88 字符，无法存入 20 字符。本脚本严格保留
--       VARCHAR(20) 以忠实于文档；若采用「入库即密文」方案，必须执行附录 A 的
--       ALTER 扩宽到 VARCHAR(128)，否则注册写库必然失败（超长截断或被拒）。
--  D-03 通用字段：6.1 要求业务表含 created_at / updated_at / is_deleted。按 6.1 的
--       四层前缀定义（sys_ 系统层 / biz_ 业务层 / log_ 日志层 / cfg_ 配置层），
--       「业务表」取 biz_ 层口径 —— biz_item、biz_order 补 updated_at、is_deleted；
--       sys_user 已有 updated_at；sys_credit_log 属流水账，禁止软删除
--       （否则 6.3.4 的 SUM(delta) 对账恒等式失效，见 D-06）。
--  D-04 Hash 列取值：7.3.3 请求示例为 "sha256:c9f2..."（含前缀共 71 字符），
--       而 6.3.2 定义 VARCHAR(64)。约定：应用层剥离 "sha256:" 前缀、统一小写，
--       库里只存裸 64 位十六进制，DB 层以 CHECK 兜底长度（见附录 A 备选方案）。
--  D-05 主键自增：见文件头「主键口径」。
--  D-06 流水表不可软删除：6.3.4 明确 SUM(delta) == credit_score - 100，任何
--       is_deleted 标记都会破坏该恒等式，故 sys_credit_log 不加 is_deleted，
--       改以 append-only + 日终对账 + 告警（job-fn 02:00）保证账实一致。
--  D-07 ref_id 不建外键：6.3.4 的 ref_type 为多态（order / arbitration / task），
--       MySQL 无法对多态列建外键，改由 CHECK 保证 ref_type 与 ref_id 成对出现，
--       引用完整性由应用层在同一事务内校验。
--  D-08 冻结分与总分不做 CHECK：仲裁扣分存在 credit_frozen > credit_score 的
--       边界情形（扣分后总分低于已冻结分），文档未定义处理方式，故不在 DB 层
--       设 credit_frozen <= credit_score 约束，待业务确认（见附录 B 待确认项）。
--  D-09 信用分下界：L0 区间下界为 0，故 credit_score / balance_after 设 CHECK >= 0，
--       扣分写入必须由应用层夹紧到 0（事务内先算 max(0, score + delta)）。
-- ============================================================================
--
--  【执行方式】
--    mysql -h <host> -u <user> -p < sql/init_db.sql
--  云端 RDS / PaaS 通常已预建库，请注释掉下面的 CREATE DATABASE 与 USE 语句，
--  改为在控制台建库后直接对本库执行本脚本。
-- ============================================================================

SET NAMES utf8mb4;
SET time_zone = '+00:00';

CREATE DATABASE IF NOT EXISTS `yxx`
  DEFAULT CHARACTER SET utf8mb4
  DEFAULT COLLATE utf8mb4_0900_ai_ci;

USE `yxx`;

-- ----------------------------------------------------------------------------
-- 【重建模式 · 危险操作，默认注释】
-- 仅用于本地开发 / CI 环境全量重建；生产环境禁用，迁移一律走增量脚本。
-- ----------------------------------------------------------------------------
-- SET FOREIGN_KEY_CHECKS = 0;
-- DROP TABLE IF EXISTS `sys_credit_log`;
-- DROP TABLE IF EXISTS `biz_order`;
-- DROP TABLE IF EXISTS `biz_item`;
-- DROP TABLE IF EXISTS `sys_user`;
-- SET FOREIGN_KEY_CHECKS = 1;


-- ============================================================================
-- 1. sys_user  用户表（6.3.1）
--    平台基础实体：学号密文 + Hash 双列存储，信用分与等级为计分引擎的落地位。
-- ============================================================================
CREATE TABLE IF NOT EXISTS `sys_user` (
  `id`              BIGINT       NOT NULL AUTO_INCREMENT           COMMENT '用户唯一标识',
  `student_no`      VARCHAR(20)  NOT NULL                          COMMENT '学号（AES-256 加密存储；明文查询走 student_no_hash，列宽风险见 D-02）',
  `student_no_hash` CHAR(64)     NOT NULL                          COMMENT '学号 SHA-256 十六进制 Hash（唯一性校验与快速查询，避免对密文建索引）',
  `real_name`       VARCHAR(50)  NOT NULL                          COMMENT '真实姓名（AES-256 加密存储）',
  `college_code`    VARCHAR(10)  NOT NULL                          COMMENT '学院代码（用于 L2 院系映射一致性校验）',
  `major_code`      VARCHAR(10)  NULL     DEFAULT NULL             COMMENT '专业代码（可空，部分学院不细分）',
  `credit_score`    INT          NOT NULL DEFAULT 100              COMMENT '信用总分，默认 100（对账口径 SUM(delta)=credit_score-100）',
  `credit_frozen`   INT          NOT NULL DEFAULT 0                COMMENT '当前冻结信用分（高值物品押金，见 5.4.3）',
  `credit_level`    TINYINT      NOT NULL DEFAULT 4                COMMENT '信用等级：0 冻结 / 1 受限 / 2 观察 / 3 正常 / 4 良好 / 5 校园信用之星',
  `device_fp`       VARCHAR(128) NOT NULL                          COMMENT '设备指纹 Hash（单设备最多绑定 2 个账号）',
  `invite_code`     VARCHAR(20)  NULL     DEFAULT NULL             COMMENT '专属邀请码（注册强制填写，单账号上限 5 个有效邀请）',
  `invited_by`      BIGINT       NULL     DEFAULT NULL             COMMENT '邀请人用户 ID（自关联，用于邀请连带责任扣分）',
  `webauthn_pubkey` TEXT         NULL                              COMMENT 'WebAuthn 公钥（私钥永不出端，平台无法反推生物特征）',
  `building_loc`    VARCHAR(50)  NULL     DEFAULT NULL             COMMENT '常驻楼栋（LBS 定向与同楼匹配）',
  `status`          TINYINT      NOT NULL DEFAULT 1                COMMENT '账号状态：0 封禁 / 1 正常 / 2 限制',
  `created_at`      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '注册时间（UTC）',
  `updated_at`      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP
                                  ON UPDATE CURRENT_TIMESTAMP       COMMENT '更新时间（UTC）',

  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_student_no_hash` (`student_no_hash`)
    COMMENT '学号 Hash 唯一键：身份唯一性的真正落点（明文/密文均不建唯一索引）',
  UNIQUE KEY `uk_invite_code` (`invite_code`)
    COMMENT '邀请码唯一键：同时承担 6.4 中 idx_invite_code 的查询职责',
  KEY `idx_device_fp` (`device_fp`)
    COMMENT '设备防重与绑定数超限校验（L4 社交层）',
  KEY `idx_invited_by` (`invited_by`)
    COMMENT '外键所需索引：邀请链路与连带责任追溯',

  CONSTRAINT `chk_user_student_no_hash_len`
    CHECK (CHAR_LENGTH(`student_no_hash`) = 64),
  CONSTRAINT `chk_user_credit_level`
    CHECK (`credit_level` BETWEEN 0 AND 5),
  CONSTRAINT `chk_user_credit_score_nonneg`
    CHECK (`credit_score` >= 0),
  CONSTRAINT `chk_user_credit_frozen_nonneg`
    CHECK (`credit_frozen` >= 0),
  CONSTRAINT `chk_user_status`
    CHECK (`status` IN (0, 1, 2)),
  CONSTRAINT `fk_user_invited_by`
    FOREIGN KEY (`invited_by`) REFERENCES `sys_user` (`id`)
    ON DELETE SET NULL ON UPDATE RESTRICT
) ENGINE = InnoDB
  DEFAULT CHARSET = utf8mb4
  COLLATE = utf8mb4_0900_ai_ci
  COMMENT = '用户表：身份准入、信用分/等级、WebAuthn 公钥与设备指纹（文档 6.3.1）';


-- ============================================================================
-- 2. biz_item  物品表（6.3.2）
--    发布侧实体：deposit_score 驱动押金冻结，damage_rules 为发布时冻结的定损快照源。
-- ============================================================================
CREATE TABLE IF NOT EXISTS `biz_item` (
  `id`             BIGINT       NOT NULL AUTO_INCREMENT            COMMENT '物品 ID',
  `owner_id`       BIGINT       NOT NULL                           COMMENT '发布者用户 ID',
  `title`          VARCHAR(100) NOT NULL                           COMMENT '物品名称',
  `category`       VARCHAR(30)  NOT NULL                           COMMENT '类目代码：apparel 服饰 / digital 数码 / teaching_aid 教具 / tools 工具 / other 其他（wig、formal_wear 为 apparel 子类）',
  `image_hash`     VARCHAR(64)  NOT NULL                           COMMENT '主图内容 Hash（裸 64 位小写十六进制，剥离 sha256: 前缀，见 D-04）',
  `image_list`     JSON         NULL                               COMMENT '多图 Hash 数组（内容寻址缓存，见 8.2）',
  `deposit_score`  INT          NOT NULL                           COMMENT '借用所需冻结信用分（5.4.3 虚拟押金冻结）',
  `damage_rules`   JSON         NOT NULL                           COMMENT '损坏赔偿规则字典（结构见 config/damage_rules_wig.json）',
  `building_loc`   VARCHAR(50)  NOT NULL                           COMMENT '所在楼栋（同楼匹配与广告定向）',
  `is_high_value`  TINYINT      NOT NULL DEFAULT 0                 COMMENT '是否高值物品：0 否 / 1 是（高值物品受等级权限与押金约束）',
  `status`         TINYINT      NOT NULL DEFAULT 0                 COMMENT '物品状态：0 待借 / 1 已借出 / 2 下架 / 3 审核中',
  `expire_at`      DATETIME     NULL     DEFAULT NULL              COMMENT '自动下架时间（UTC，可空表示不过期）',
  `created_at`     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '发布时间（UTC）',
  `updated_at`     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP
                                  ON UPDATE CURRENT_TIMESTAMP      COMMENT '更新时间（UTC，6.1 通用字段）',
  `is_deleted`     TINYINT      NOT NULL DEFAULT 0                 COMMENT '软删除标记：0 未删除 / 1 已删除（6.1 通用字段）',

  PRIMARY KEY (`id`),
  KEY `idx_owner` (`owner_id`)
    COMMENT '发布者维度查询：我的发布列表',
  KEY `idx_status_category` (`status`, `category`)
    COMMENT '列表主查询：按状态 + 类目筛选（6.4）',
  KEY `idx_building` (`building_loc`)
    COMMENT '同楼栋匹配与广告定向查询（6.4）',

  CONSTRAINT `chk_item_deposit_score_nonneg`
    CHECK (`deposit_score` >= 0),
  CONSTRAINT `chk_item_is_high_value`
    CHECK (`is_high_value` IN (0, 1)),
  CONSTRAINT `chk_item_status`
    CHECK (`status` IN (0, 1, 2, 3)),
  CONSTRAINT `chk_item_is_deleted`
    CHECK (`is_deleted` IN (0, 1)),
  CONSTRAINT `chk_item_image_hash_len`
    CHECK (CHAR_LENGTH(`image_hash`) = 64),
  CONSTRAINT `fk_item_owner`
    FOREIGN KEY (`owner_id`) REFERENCES `sys_user` (`id`)
    ON DELETE RESTRICT ON UPDATE RESTRICT
) ENGINE = InnoDB
  DEFAULT CHARSET = utf8mb4
  COLLATE = utf8mb4_0900_ai_ci
  COMMENT = '物品表：发布、押金分、定损规则与借出状态（文档 6.3.2）';


-- ============================================================================
-- 3. biz_order  订单与仲裁表（6.3.3）
--    交易主实体：snapshot 为下单时刻的规则快照（仲裁以此为准，防出借者事后篡改）。
-- ============================================================================
CREATE TABLE IF NOT EXISTS `biz_order` (
  `id`               BIGINT       NOT NULL AUTO_INCREMENT            COMMENT '订单 ID',
  `order_no`         VARCHAR(32)  NOT NULL                           COMMENT '业务单号（对外展示，如 YXX2026110700017）',
  `item_id`          BIGINT       NOT NULL                           COMMENT '物品 ID',
  `borrower_id`      BIGINT       NOT NULL                           COMMENT '借用者用户 ID',
  `owner_id`         BIGINT       NOT NULL                           COMMENT '出借者用户 ID（下单时冗余，防物品易主导致归属漂移）',
  `pre_video_hash`   VARCHAR(64)  NOT NULL                           COMMENT '交接前视频摘要（E1 强证据，sha256 裸十六进制）',
  `post_video_hash`  VARCHAR(64)  NULL     DEFAULT NULL              COMMENT '归还后视频摘要（未归还时为空）',
  `frozen_score`     INT          NOT NULL                           COMMENT '本单冻结的信用分（与 sys_credit_log 冻结/解冻流水成对）',
  `snapshot`         JSON         NOT NULL                           COMMENT '下单时刻的规则与物品快照：定损表、描述、图片 Hash（E2 证据）',
  `idempotency_key`  VARCHAR(64)  NULL     DEFAULT NULL              COMMENT '幂等键（对应 Idempotency-Key 请求头，服务端缓存 24 小时）',
  `state`            TINYINT      NOT NULL                           COMMENT '订单状态：0 待交接 / 1 使用中 / 2 已完成 / 3 仲裁中 / 4 已取消（无默认值，写入必须显式指定）',
  `due_at`           DATETIME     NULL     DEFAULT NULL              COMMENT '约定归还时间（UTC）',
  `arbitration_res`  VARCHAR(255) NULL     DEFAULT NULL              COMMENT '仲裁结果说明（败诉冷静期与扣分依据）',
  `created_at`       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间（UTC）',
  `updated_at`       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP
                                   ON UPDATE CURRENT_TIMESTAMP       COMMENT '更新时间（UTC，6.1 通用字段）',
  `is_deleted`       TINYINT      NOT NULL DEFAULT 0                 COMMENT '软删除标记：0 未删除 / 1 已删除（6.1 通用字段）',

  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_order_no` (`order_no`)
    COMMENT '业务单号全局唯一，对外暴露与客服检索的唯一入口',
  UNIQUE KEY `uk_idempotency_key` (`idempotency_key`)
    COMMENT '幂等键唯一（NULL 允许多行，未传幂等头时不参与约束）',
  KEY `idx_item_state` (`item_id`, `state`)
    COMMENT '物品维度状态查询：判断是否已被借出（40901 冲突判定）',
  KEY `idx_borrower` (`borrower_id`)
    COMMENT '借用人维度：我的借用列表与连续逾期计数',
  KEY `idx_owner_state` (`owner_id`, `state`)
    COMMENT '出借人维度：待确认归还/待定损工单池（6.4 未列，为本表 FK 与业务查询补建）',

  CONSTRAINT `chk_order_state`
    CHECK (`state` IN (0, 1, 2, 3, 4)),
  CONSTRAINT `chk_order_frozen_score_nonneg`
    CHECK (`frozen_score` >= 0),
  CONSTRAINT `chk_order_is_deleted`
    CHECK (`is_deleted` IN (0, 1)),
  CONSTRAINT `chk_order_pre_video_hash_len`
    CHECK (CHAR_LENGTH(`pre_video_hash`) = 64),
  CONSTRAINT `chk_order_post_video_hash_len`
    CHECK (`post_video_hash` IS NULL OR CHAR_LENGTH(`post_video_hash`) = 64),
  CONSTRAINT `chk_order_borrower_not_owner`
    CHECK (`borrower_id` <> `owner_id`),
  CONSTRAINT `chk_order_no_len`
    CHECK (CHAR_LENGTH(`order_no`) BETWEEN 1 AND 32),
  CONSTRAINT `fk_order_item`
    FOREIGN KEY (`item_id`) REFERENCES `biz_item` (`id`)
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `fk_order_borrower`
    FOREIGN KEY (`borrower_id`) REFERENCES `sys_user` (`id`)
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `fk_order_owner`
    FOREIGN KEY (`owner_id`) REFERENCES `sys_user` (`id`)
    ON DELETE RESTRICT ON UPDATE RESTRICT
) ENGINE = InnoDB
  DEFAULT CHARSET = utf8mb4
  COLLATE = utf8mb4_0900_ai_ci
  COMMENT = '订单与仲裁表：借用生命周期、证据 Hash 与规则快照（文档 6.3.3）';


-- ============================================================================
-- 4. sys_credit_log  信用流水表（6.3.4）
--    账实一致的唯一凭证：冻结/解冻必须成对写入，禁止 UPDATE / DELETE（append-only）。
--    日终对账断言：SUM(delta) == sys_user.credit_score - 100
-- ============================================================================
CREATE TABLE IF NOT EXISTS `sys_credit_log` (
  `id`            BIGINT       NOT NULL AUTO_INCREMENT            COMMENT '流水 ID（6.1 约定 BIGINT 自增，见 D-05）',
  `user_id`       BIGINT       NOT NULL                           COMMENT '用户 ID',
  `change_type`   VARCHAR(20)  NOT NULL                           COMMENT '变动类型：freeze 冻结 / unfreeze 解冻 / add 加分 / deduct 扣分',
  `delta`         INT          NOT NULL                           COMMENT '变动值（可为负；add 为正、deduct 为负，冻结/解冻记 0）',
  `balance_after` INT          NOT NULL                           COMMENT '变动后信用总分（快照，便于审计与回放）',
  `frozen_after`  INT          NOT NULL                           COMMENT '变动后冻结分（与 balance_after 同时刻快照）',
  `ref_type`      VARCHAR(20)  NULL     DEFAULT NULL              COMMENT '关联类型：order 订单 / arbitration 仲裁 / task 互助任务（多态，不建外键，见 D-07）',
  `ref_id`        BIGINT       NULL     DEFAULT NULL              COMMENT '关联业务 ID（随 ref_type 解释其归属表）',
  `reason`        VARCHAR(255) NULL     DEFAULT NULL              COMMENT '变动理由（对应 rule_key 或仲裁裁决摘要，便于客服追溯）',
  `created_at`    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '发生时间（UTC，作为流水时序与对账窗口依据）',

  PRIMARY KEY (`id`),
  KEY `idx_user_time` (`user_id`, `created_at`)
    COMMENT '联合索引：按用户查流水并时间倒序（6.4）；亦覆盖 user_id 外键',
  KEY `idx_ref` (`ref_type`, `ref_id`)
    COMMENT '反查某个订单/仲裁产生的全部流水（6.4 未列，为对账与申诉举证补建）',

  CONSTRAINT `chk_log_change_type`
    CHECK (`change_type` IN ('freeze', 'unfreeze', 'add', 'deduct')),
  CONSTRAINT `chk_log_delta_direction`
    CHECK (
      `change_type` IN ('freeze', 'unfreeze')
      OR (`change_type` = 'add'    AND `delta` > 0)
      OR (`change_type` = 'deduct' AND `delta` < 0)
    ),
  CONSTRAINT `chk_log_balance_after_nonneg`
    CHECK (`balance_after` >= 0),
  CONSTRAINT `chk_log_frozen_after_nonneg`
    CHECK (`frozen_after` >= 0),
  CONSTRAINT `chk_log_ref_type`
    CHECK (`ref_type` IS NULL OR `ref_type` IN ('order', 'arbitration', 'task')),
  CONSTRAINT `chk_log_ref_pair`
    CHECK (`ref_id` IS NULL OR `ref_type` IS NOT NULL),
  CONSTRAINT `fk_credit_log_user`
    FOREIGN KEY (`user_id`) REFERENCES `sys_user` (`id`)
    ON DELETE RESTRICT ON UPDATE RESTRICT
) ENGINE = InnoDB
  DEFAULT CHARSET = utf8mb4
  COLLATE = utf8mb4_0900_ai_ci
  COMMENT = '信用流水表：计分与冻结的唯一凭证，append-only，日终对账（文档 6.3.4）';


-- ============================================================================
-- 5. 校验查询（执行完可逐条核对）
-- ============================================================================

-- 5.1 四张表是否齐备，引擎与字符集是否符合预期
SELECT TABLE_NAME, ENGINE, TABLE_COLLATION, TABLE_COMMENT
  FROM information_schema.TABLES
 WHERE TABLE_SCHEMA = DATABASE()
   AND TABLE_NAME IN ('sys_user', 'biz_item', 'biz_order', 'sys_credit_log')
 ORDER BY TABLE_NAME;

-- 5.2 外键清单（应为 6 条：sys_user 自关联 1、biz_item 1、biz_order 3、sys_credit_log 1）
SELECT CONSTRAINT_NAME, TABLE_NAME, REFERENCED_TABLE_NAME,
       COLUMN_NAME, REFERENCED_COLUMN_NAME
  FROM information_schema.KEY_COLUMN_USAGE
 WHERE TABLE_SCHEMA = DATABASE()
   AND REFERENCED_TABLE_NAME IS NOT NULL
 ORDER BY TABLE_NAME, CONSTRAINT_NAME;

-- 5.3 唯一键清单（应为 4 条：uk_student_no_hash、uk_invite_code、uk_order_no、uk_idempotency_key）
SELECT TABLE_NAME, INDEX_NAME, GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX) AS cols
  FROM information_schema.STATISTICS
 WHERE TABLE_SCHEMA = DATABASE()
   AND NON_UNIQUE = 0
   AND INDEX_NAME <> 'PRIMARY'
 GROUP BY TABLE_NAME, INDEX_NAME
 ORDER BY TABLE_NAME;

-- 5.4 对账基线自检：新库应为空集（有数据后该查询用于核对 6.3.4 恒等式）
-- SELECT u.id, u.credit_score, COALESCE(SUM(l.delta), 0) AS delta_sum
--   FROM sys_user u
--   LEFT JOIN sys_credit_log l ON l.user_id = u.id
--  GROUP BY u.id, u.credit_score
-- HAVING delta_sum <> u.credit_score - 100;


-- ============================================================================
-- 附录 A · 与文档存在张力的两处可选变更（默认不执行，需变更控制流程审批）
-- ============================================================================

-- A-1 若坚持 6.3.1「约束」列的字面语义，为 student_no 补唯一键。
--     注意：AES-256-GCM 相同明文每次加密结果不同，该唯一键无法真正防重，
--     且会让密文索引暴露密文长度分布（违背 D-01）。
-- ALTER TABLE `sys_user`
--   ADD UNIQUE KEY `uk_student_no` (`student_no`);

-- A-2 若采用「入库即密文」方案，扩宽学号密文列（D-02 的强制前置条件）。
--     VARCHAR(128) 可容纳 Base64(IV 12B + Tag 16B + 明文 20B) ≈ 88 字符。
-- ALTER TABLE `sys_user`
--   MODIFY COLUMN `student_no` VARCHAR(128) NOT NULL
--     COMMENT '学号（AES-256-GCM 密文 Base64，含 IV 与 Tag）';

-- A-3 若决定原样存储 7.3.3 示例中的 "sha256:xxxx" 形式（71 字符），
--     则需同时放宽 image_hash / pre_video_hash / post_video_hash 的列宽与 CHECK。
-- ALTER TABLE `biz_item`
--   MODIFY COLUMN `image_hash` VARCHAR(71) NOT NULL COMMENT '主图 Hash（含 sha256: 前缀）',
--   DROP CHECK `chk_item_image_hash_len`;


-- ============================================================================
-- 附录 B · 未纳入本脚本 / 待业务确认
-- ----------------------------------------------------------------------------
--  B-1 本章其余表（biz_arbitration、sys_invite、biz_subscription、cfg_ad_slot、
--      biz_report、cfg_credit_rule）与 6.1 提及的 log_action、log_audit 未包含，
--      按 6.3.5 / 6.3.6 另启迁移脚本 sql/V1.1.0__aux_tables.sql。
--  B-2 待确认（D-08）：仲裁扣分后 credit_frozen > credit_score 的处理口径
--      （是允许超冻、还是强制解冻差额、还是拒绝裁决）。
--  B-3 待确认：is_deleted 生效后 6.4 的 idx_status_category 是否需前置
--      is_deleted（软删除过滤会使该复合索引选择性下降）。
--  B-4 待确认：biz_item.category 是否需要独立字典表 + 外键（当前按 7.3.3 用
--      VARCHAR 代码，便于快速迭代；若类目可运营配置，建议升级为 cfg_item_category）。
--  B-5 性能建议（非本次 DDL）：sys_credit_log 按月 RANGE 分区（PARTITION BY
--      RANGE (TO_DAYS(created_at))），并配 180 天热数据保留策略以契合
--      《网络安全法》日志留存要求与冷备归档。
-- ============================================================================

-- init_db.sql 结束
