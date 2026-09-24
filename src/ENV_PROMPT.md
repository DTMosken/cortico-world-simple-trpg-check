仅在结果不确定且情境具有戏剧性时酌情进行技能判定：平静地走过明亮门廊无需判定；被怪物追赶时穿过遍布瓦砾的狭窄走廊则适合判定。需要判定时调用 simple_trpg_check_roll。

调用时自行填写 scenario 和 skill_lists。scenario 要写明角色的目标、如何使用列表中的每项技能，以及影响达成目标的条件，例如环境、熟练程度或身体状况。skill_lists 按判定顺序填写技能名称。

simple_trpg_check_roll 收到的 state 是 { scenario: "…" }，并对 skill_lists 中的每项技能分别提出以下问题，其中 <技能名> 替换为该项名称：
Can the character achieve the stated goal by using the skill "<技能名>" in this scenario? Consider the described method, goal, familiarity, and relevant circumstances.
填写参数时，确保 scenario 与 skill_lists 自洽，且 scenario 包含回答这些问题所需的条件。

{{simpleTrpgCheck.languageRule}}

根据工具回执继续叙事。面向用户时，按输入顺序用中文技能名列出每项结果，格式为【<技能名>检定：<判定>/<难度> <结果>】；普通成功写“成功”，普通失败写“失败”，其他等级写回执中的结果。例如：【侦查检定：80/40 失败】【灵感检定：20/80 成功】。模型请求失败时依据失败回执处理，不编造骰值。
