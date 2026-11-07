-- ARCH "Fill next week" (11-06 review #25, triage CHANGE; Ivan 27 Oct: only repurposed posts go out without Davorin).
-- Rollback: db/20261107_arch_fill_next_week_rollback.sql
-- ARCH rework overlap (Ivan 27-28 Oct 2026): word-sequence similarity of a rework against Davorin's original.
-- A straight port of the check every ARCH rework was measured with (sessions 28 Oct and 1 Nov):
--   w = lambda s: re.findall(r"[\w'€$%,.]+", s.lower())
--   difflib.SequenceMatcher(None, w(rework), w(original), autojunk=False).ratio()
-- Hold anything above 0.40. Same tokens, same matching blocks (longest match first, earliest on ties), same ratio.
-- Tokens: Python's \w is spelled out as codepoint ranges (generated from python3 re: every codepoint \w matches,
-- 771 ranges), so the tokens never depend on the database locale. PostgreSQL's own \w missed 6,132 of them
-- (fractions like ⅓, circled and other-script numbers). Parity checked over every assigned codepoint, 11-07.
create or replace function public.arch_rework_tokens(p text)
returns text[] language sql immutable parallel safe set search_path = pg_catalog as $$
  select coalesce(array_agg(m[1] order by n), '{}'::text[])
    from regexp_matches(lower(coalesce(p, '')), '([\u0030-\u0039\u0041-\u005a\u005f\u0061-\u007a\u00aa\u00b2-\u00b3\u00b5\u00b9-\u00ba\u00bc-\u00be\u00c0-\u00d6\u00d8-\u00f6\u00f8-\u02c1\u02c6-\u02d1\u02e0-\u02e4\u02ec\u02ee\u0370-\u0374\u0376-\u0377\u037a-\u037d\u037f\u0386\u0388-\u038a\u038c\u038e-\u03a1\u03a3-\u03f5\u03f7-\u0481\u048a-\u052f\u0531-\u0556\u0559\u0560-\u0588\u05d0-\u05ea\u05ef-\u05f2\u0620-\u064a\u0660-\u0669\u066e-\u066f\u0671-\u06d3\u06d5\u06e5-\u06e6\u06ee-\u06fc\u06ff\u0710\u0712-\u072f\u074d-\u07a5\u07b1\u07c0-\u07ea\u07f4-\u07f5\u07fa\u0800-\u0815\u081a\u0824\u0828\u0840-\u0858\u0860-\u086a\u0870-\u0887\u0889-\u088e\u08a0-\u08c9\u0904-\u0939\u093d\u0950\u0958-\u0961\u0966-\u096f\u0971-\u0980\u0985-\u098c\u098f-\u0990\u0993-\u09a8\u09aa-\u09b0\u09b2\u09b6-\u09b9\u09bd\u09ce\u09dc-\u09dd\u09df-\u09e1\u09e6-\u09f1\u09f4-\u09f9\u09fc\u0a05-\u0a0a\u0a0f-\u0a10\u0a13-\u0a28\u0a2a-\u0a30\u0a32-\u0a33\u0a35-\u0a36\u0a38-\u0a39\u0a59-\u0a5c\u0a5e\u0a66-\u0a6f\u0a72-\u0a74\u0a85-\u0a8d\u0a8f-\u0a91\u0a93-\u0aa8\u0aaa-\u0ab0\u0ab2-\u0ab3\u0ab5-\u0ab9\u0abd\u0ad0\u0ae0-\u0ae1\u0ae6-\u0aef\u0af9\u0b05-\u0b0c\u0b0f-\u0b10\u0b13-\u0b28\u0b2a-\u0b30\u0b32-\u0b33\u0b35-\u0b39\u0b3d\u0b5c-\u0b5d\u0b5f-\u0b61\u0b66-\u0b6f\u0b71-\u0b77\u0b83\u0b85-\u0b8a\u0b8e-\u0b90\u0b92-\u0b95\u0b99-\u0b9a\u0b9c\u0b9e-\u0b9f\u0ba3-\u0ba4\u0ba8-\u0baa\u0bae-\u0bb9\u0bd0\u0be6-\u0bf2\u0c05-\u0c0c\u0c0e-\u0c10\u0c12-\u0c28\u0c2a-\u0c39\u0c3d\u0c58-\u0c5a\u0c5d\u0c60-\u0c61\u0c66-\u0c6f\u0c78-\u0c7e\u0c80\u0c85-\u0c8c\u0c8e-\u0c90\u0c92-\u0ca8\u0caa-\u0cb3\u0cb5-\u0cb9\u0cbd\u0cdd-\u0cde\u0ce0-\u0ce1\u0ce6-\u0cef\u0cf1-\u0cf2\u0d04-\u0d0c\u0d0e-\u0d10\u0d12-\u0d3a\u0d3d\u0d4e\u0d54-\u0d56\u0d58-\u0d61\u0d66-\u0d78\u0d7a-\u0d7f\u0d85-\u0d96\u0d9a-\u0db1\u0db3-\u0dbb\u0dbd\u0dc0-\u0dc6\u0de6-\u0def\u0e01-\u0e30\u0e32-\u0e33\u0e40-\u0e46\u0e50-\u0e59\u0e81-\u0e82\u0e84\u0e86-\u0e8a\u0e8c-\u0ea3\u0ea5\u0ea7-\u0eb0\u0eb2-\u0eb3\u0ebd\u0ec0-\u0ec4\u0ec6\u0ed0-\u0ed9\u0edc-\u0edf\u0f00\u0f20-\u0f33\u0f40-\u0f47\u0f49-\u0f6c\u0f88-\u0f8c\u1000-\u102a\u103f-\u1049\u1050-\u1055\u105a-\u105d\u1061\u1065-\u1066\u106e-\u1070\u1075-\u1081\u108e\u1090-\u1099\u10a0-\u10c5\u10c7\u10cd\u10d0-\u10fa\u10fc-\u1248\u124a-\u124d\u1250-\u1256\u1258\u125a-\u125d\u1260-\u1288\u128a-\u128d\u1290-\u12b0\u12b2-\u12b5\u12b8-\u12be\u12c0\u12c2-\u12c5\u12c8-\u12d6\u12d8-\u1310\u1312-\u1315\u1318-\u135a\u1369-\u137c\u1380-\u138f\u13a0-\u13f5\u13f8-\u13fd\u1401-\u166c\u166f-\u167f\u1681-\u169a\u16a0-\u16ea\u16ee-\u16f8\u1700-\u1711\u171f-\u1731\u1740-\u1751\u1760-\u176c\u176e-\u1770\u1780-\u17b3\u17d7\u17dc\u17e0-\u17e9\u17f0-\u17f9\u1810-\u1819\u1820-\u1878\u1880-\u1884\u1887-\u18a8\u18aa\u18b0-\u18f5\u1900-\u191e\u1946-\u196d\u1970-\u1974\u1980-\u19ab\u19b0-\u19c9\u19d0-\u19da\u1a00-\u1a16\u1a20-\u1a54\u1a80-\u1a89\u1a90-\u1a99\u1aa7\u1b05-\u1b33\u1b45-\u1b4c\u1b50-\u1b59\u1b83-\u1ba0\u1bae-\u1be5\u1c00-\u1c23\u1c40-\u1c49\u1c4d-\u1c7d\u1c80-\u1c8a\u1c90-\u1cba\u1cbd-\u1cbf\u1ce9-\u1cec\u1cee-\u1cf3\u1cf5-\u1cf6\u1cfa\u1d00-\u1dbf\u1e00-\u1f15\u1f18-\u1f1d\u1f20-\u1f45\u1f48-\u1f4d\u1f50-\u1f57\u1f59\u1f5b\u1f5d\u1f5f-\u1f7d\u1f80-\u1fb4\u1fb6-\u1fbc\u1fbe\u1fc2-\u1fc4\u1fc6-\u1fcc\u1fd0-\u1fd3\u1fd6-\u1fdb\u1fe0-\u1fec\u1ff2-\u1ff4\u1ff6-\u1ffc\u2070-\u2071\u2074-\u2079\u207f-\u2089\u2090-\u209c\u2102\u2107\u210a-\u2113\u2115\u2119-\u211d\u2124\u2126\u2128\u212a-\u212d\u212f-\u2139\u213c-\u213f\u2145-\u2149\u214e\u2150-\u2189\u2460-\u249b\u24ea-\u24ff\u2776-\u2793\u2c00-\u2ce4\u2ceb-\u2cee\u2cf2-\u2cf3\u2cfd\u2d00-\u2d25\u2d27\u2d2d\u2d30-\u2d67\u2d6f\u2d80-\u2d96\u2da0-\u2da6\u2da8-\u2dae\u2db0-\u2db6\u2db8-\u2dbe\u2dc0-\u2dc6\u2dc8-\u2dce\u2dd0-\u2dd6\u2dd8-\u2dde\u2e2f\u3005-\u3007\u3021-\u3029\u3031-\u3035\u3038-\u303c\u3041-\u3096\u309d-\u309f\u30a1-\u30fa\u30fc-\u30ff\u3105-\u312f\u3131-\u318e\u3192-\u3195\u31a0-\u31bf\u31f0-\u31ff\u3220-\u3229\u3248-\u324f\u3251-\u325f\u3280-\u3289\u32b1-\u32bf\u3400-\u4dbf\u4e00-\ua48c\ua4d0-\ua4fd\ua500-\ua60c\ua610-\ua62b\ua640-\ua66e\ua67f-\ua69d\ua6a0-\ua6ef\ua717-\ua71f\ua722-\ua788\ua78b-\ua7cd\ua7d0-\ua7d1\ua7d3\ua7d5-\ua7dc\ua7f2-\ua801\ua803-\ua805\ua807-\ua80a\ua80c-\ua822\ua830-\ua835\ua840-\ua873\ua882-\ua8b3\ua8d0-\ua8d9\ua8f2-\ua8f7\ua8fb\ua8fd-\ua8fe\ua900-\ua925\ua930-\ua946\ua960-\ua97c\ua984-\ua9b2\ua9cf-\ua9d9\ua9e0-\ua9e4\ua9e6-\ua9fe\uaa00-\uaa28\uaa40-\uaa42\uaa44-\uaa4b\uaa50-\uaa59\uaa60-\uaa76\uaa7a\uaa7e-\uaaaf\uaab1\uaab5-\uaab6\uaab9-\uaabd\uaac0\uaac2\uaadb-\uaadd\uaae0-\uaaea\uaaf2-\uaaf4\uab01-\uab06\uab09-\uab0e\uab11-\uab16\uab20-\uab26\uab28-\uab2e\uab30-\uab5a\uab5c-\uab69\uab70-\uabe2\uabf0-\uabf9\uac00-\ud7a3\ud7b0-\ud7c6\ud7cb-\ud7fb\uf900-\ufa6d\ufa70-\ufad9\ufb00-\ufb06\ufb13-\ufb17\ufb1d\ufb1f-\ufb28\ufb2a-\ufb36\ufb38-\ufb3c\ufb3e\ufb40-\ufb41\ufb43-\ufb44\ufb46-\ufbb1\ufbd3-\ufd3d\ufd50-\ufd8f\ufd92-\ufdc7\ufdf0-\ufdfb\ufe70-\ufe74\ufe76-\ufefc\uff10-\uff19\uff21-\uff3a\uff41-\uff5a\uff66-\uffbe\uffc2-\uffc7\uffca-\uffcf\uffd2-\uffd7\uffda-\uffdc\U00010000-\U0001000b\U0001000d-\U00010026\U00010028-\U0001003a\U0001003c-\U0001003d\U0001003f-\U0001004d\U00010050-\U0001005d\U00010080-\U000100fa\U00010107-\U00010133\U00010140-\U00010178\U0001018a-\U0001018b\U00010280-\U0001029c\U000102a0-\U000102d0\U000102e1-\U000102fb\U00010300-\U00010323\U0001032d-\U0001034a\U00010350-\U00010375\U00010380-\U0001039d\U000103a0-\U000103c3\U000103c8-\U000103cf\U000103d1-\U000103d5\U00010400-\U0001049d\U000104a0-\U000104a9\U000104b0-\U000104d3\U000104d8-\U000104fb\U00010500-\U00010527\U00010530-\U00010563\U00010570-\U0001057a\U0001057c-\U0001058a\U0001058c-\U00010592\U00010594-\U00010595\U00010597-\U000105a1\U000105a3-\U000105b1\U000105b3-\U000105b9\U000105bb-\U000105bc\U000105c0-\U000105f3\U00010600-\U00010736\U00010740-\U00010755\U00010760-\U00010767\U00010780-\U00010785\U00010787-\U000107b0\U000107b2-\U000107ba\U00010800-\U00010805\U00010808\U0001080a-\U00010835\U00010837-\U00010838\U0001083c\U0001083f-\U00010855\U00010858-\U00010876\U00010879-\U0001089e\U000108a7-\U000108af\U000108e0-\U000108f2\U000108f4-\U000108f5\U000108fb-\U0001091b\U00010920-\U00010939\U00010980-\U000109b7\U000109bc-\U000109cf\U000109d2-\U00010a00\U00010a10-\U00010a13\U00010a15-\U00010a17\U00010a19-\U00010a35\U00010a40-\U00010a48\U00010a60-\U00010a7e\U00010a80-\U00010a9f\U00010ac0-\U00010ac7\U00010ac9-\U00010ae4\U00010aeb-\U00010aef\U00010b00-\U00010b35\U00010b40-\U00010b55\U00010b58-\U00010b72\U00010b78-\U00010b91\U00010ba9-\U00010baf\U00010c00-\U00010c48\U00010c80-\U00010cb2\U00010cc0-\U00010cf2\U00010cfa-\U00010d23\U00010d30-\U00010d39\U00010d40-\U00010d65\U00010d6f-\U00010d85\U00010e60-\U00010e7e\U00010e80-\U00010ea9\U00010eb0-\U00010eb1\U00010ec2-\U00010ec4\U00010f00-\U00010f27\U00010f30-\U00010f45\U00010f51-\U00010f54\U00010f70-\U00010f81\U00010fb0-\U00010fcb\U00010fe0-\U00010ff6\U00011003-\U00011037\U00011052-\U0001106f\U00011071-\U00011072\U00011075\U00011083-\U000110af\U000110d0-\U000110e8\U000110f0-\U000110f9\U00011103-\U00011126\U00011136-\U0001113f\U00011144\U00011147\U00011150-\U00011172\U00011176\U00011183-\U000111b2\U000111c1-\U000111c4\U000111d0-\U000111da\U000111dc\U000111e1-\U000111f4\U00011200-\U00011211\U00011213-\U0001122b\U0001123f-\U00011240\U00011280-\U00011286\U00011288\U0001128a-\U0001128d\U0001128f-\U0001129d\U0001129f-\U000112a8\U000112b0-\U000112de\U000112f0-\U000112f9\U00011305-\U0001130c\U0001130f-\U00011310\U00011313-\U00011328\U0001132a-\U00011330\U00011332-\U00011333\U00011335-\U00011339\U0001133d\U00011350\U0001135d-\U00011361\U00011380-\U00011389\U0001138b\U0001138e\U00011390-\U000113b5\U000113b7\U000113d1\U000113d3\U00011400-\U00011434\U00011447-\U0001144a\U00011450-\U00011459\U0001145f-\U00011461\U00011480-\U000114af\U000114c4-\U000114c5\U000114c7\U000114d0-\U000114d9\U00011580-\U000115ae\U000115d8-\U000115db\U00011600-\U0001162f\U00011644\U00011650-\U00011659\U00011680-\U000116aa\U000116b8\U000116c0-\U000116c9\U000116d0-\U000116e3\U00011700-\U0001171a\U00011730-\U0001173b\U00011740-\U00011746\U00011800-\U0001182b\U000118a0-\U000118f2\U000118ff-\U00011906\U00011909\U0001190c-\U00011913\U00011915-\U00011916\U00011918-\U0001192f\U0001193f\U00011941\U00011950-\U00011959\U000119a0-\U000119a7\U000119aa-\U000119d0\U000119e1\U000119e3\U00011a00\U00011a0b-\U00011a32\U00011a3a\U00011a50\U00011a5c-\U00011a89\U00011a9d\U00011ab0-\U00011af8\U00011bc0-\U00011be0\U00011bf0-\U00011bf9\U00011c00-\U00011c08\U00011c0a-\U00011c2e\U00011c40\U00011c50-\U00011c6c\U00011c72-\U00011c8f\U00011d00-\U00011d06\U00011d08-\U00011d09\U00011d0b-\U00011d30\U00011d46\U00011d50-\U00011d59\U00011d60-\U00011d65\U00011d67-\U00011d68\U00011d6a-\U00011d89\U00011d98\U00011da0-\U00011da9\U00011ee0-\U00011ef2\U00011f02\U00011f04-\U00011f10\U00011f12-\U00011f33\U00011f50-\U00011f59\U00011fb0\U00011fc0-\U00011fd4\U00012000-\U00012399\U00012400-\U0001246e\U00012480-\U00012543\U00012f90-\U00012ff0\U00013000-\U0001342f\U00013441-\U00013446\U00013460-\U000143fa\U00014400-\U00014646\U00016100-\U0001611d\U00016130-\U00016139\U00016800-\U00016a38\U00016a40-\U00016a5e\U00016a60-\U00016a69\U00016a70-\U00016abe\U00016ac0-\U00016ac9\U00016ad0-\U00016aed\U00016b00-\U00016b2f\U00016b40-\U00016b43\U00016b50-\U00016b59\U00016b5b-\U00016b61\U00016b63-\U00016b77\U00016b7d-\U00016b8f\U00016d40-\U00016d6c\U00016d70-\U00016d79\U00016e40-\U00016e96\U00016f00-\U00016f4a\U00016f50\U00016f93-\U00016f9f\U00016fe0-\U00016fe1\U00016fe3\U00017000-\U000187f7\U00018800-\U00018cd5\U00018cff-\U00018d08\U0001aff0-\U0001aff3\U0001aff5-\U0001affb\U0001affd-\U0001affe\U0001b000-\U0001b122\U0001b132\U0001b150-\U0001b152\U0001b155\U0001b164-\U0001b167\U0001b170-\U0001b2fb\U0001bc00-\U0001bc6a\U0001bc70-\U0001bc7c\U0001bc80-\U0001bc88\U0001bc90-\U0001bc99\U0001ccf0-\U0001ccf9\U0001d2c0-\U0001d2d3\U0001d2e0-\U0001d2f3\U0001d360-\U0001d378\U0001d400-\U0001d454\U0001d456-\U0001d49c\U0001d49e-\U0001d49f\U0001d4a2\U0001d4a5-\U0001d4a6\U0001d4a9-\U0001d4ac\U0001d4ae-\U0001d4b9\U0001d4bb\U0001d4bd-\U0001d4c3\U0001d4c5-\U0001d505\U0001d507-\U0001d50a\U0001d50d-\U0001d514\U0001d516-\U0001d51c\U0001d51e-\U0001d539\U0001d53b-\U0001d53e\U0001d540-\U0001d544\U0001d546\U0001d54a-\U0001d550\U0001d552-\U0001d6a5\U0001d6a8-\U0001d6c0\U0001d6c2-\U0001d6da\U0001d6dc-\U0001d6fa\U0001d6fc-\U0001d714\U0001d716-\U0001d734\U0001d736-\U0001d74e\U0001d750-\U0001d76e\U0001d770-\U0001d788\U0001d78a-\U0001d7a8\U0001d7aa-\U0001d7c2\U0001d7c4-\U0001d7cb\U0001d7ce-\U0001d7ff\U0001df00-\U0001df1e\U0001df25-\U0001df2a\U0001e030-\U0001e06d\U0001e100-\U0001e12c\U0001e137-\U0001e13d\U0001e140-\U0001e149\U0001e14e\U0001e290-\U0001e2ad\U0001e2c0-\U0001e2eb\U0001e2f0-\U0001e2f9\U0001e4d0-\U0001e4eb\U0001e4f0-\U0001e4f9\U0001e5d0-\U0001e5ed\U0001e5f0-\U0001e5fa\U0001e7e0-\U0001e7e6\U0001e7e8-\U0001e7eb\U0001e7ed-\U0001e7ee\U0001e7f0-\U0001e7fe\U0001e800-\U0001e8c4\U0001e8c7-\U0001e8cf\U0001e900-\U0001e943\U0001e94b\U0001e950-\U0001e959\U0001ec71-\U0001ecab\U0001ecad-\U0001ecaf\U0001ecb1-\U0001ecb4\U0001ed01-\U0001ed2d\U0001ed2f-\U0001ed3d\U0001ee00-\U0001ee03\U0001ee05-\U0001ee1f\U0001ee21-\U0001ee22\U0001ee24\U0001ee27\U0001ee29-\U0001ee32\U0001ee34-\U0001ee37\U0001ee39\U0001ee3b\U0001ee42\U0001ee47\U0001ee49\U0001ee4b\U0001ee4d-\U0001ee4f\U0001ee51-\U0001ee52\U0001ee54\U0001ee57\U0001ee59\U0001ee5b\U0001ee5d\U0001ee5f\U0001ee61-\U0001ee62\U0001ee64\U0001ee67-\U0001ee6a\U0001ee6c-\U0001ee72\U0001ee74-\U0001ee77\U0001ee79-\U0001ee7c\U0001ee7e\U0001ee80-\U0001ee89\U0001ee8b-\U0001ee9b\U0001eea1-\U0001eea3\U0001eea5-\U0001eea9\U0001eeab-\U0001eebb\U0001f100-\U0001f10c\U0001fbf0-\U0001fbf9\U00020000-\U0002a6df\U0002a700-\U0002b739\U0002b740-\U0002b81d\U0002b820-\U0002cea1\U0002ceb0-\U0002ebe0\U0002ebf0-\U0002ee5d\U0002f800-\U0002fa1d\U00030000-\U0003134a\U00031350-\U000323af''€$%,.]+)', 'g') with ordinality as t(m, n)
$$;

create or replace function public.arch_rework_overlap(p_a text, p_b text)
returns numeric language plpgsql immutable parallel safe set search_path = pg_catalog, public as $$
declare
  a text[] := public.arch_rework_tokens(p_a);
  b text[] := public.arch_rework_tokens(p_b);
  la int := coalesce(array_length(a, 1), 0);
  lb int := coalesce(array_length(b, 1), 0);
  b2j jsonb;
  todo int[] := '{}';
  alo int; ahi int; blo int; bhi int;
  besti int; bestj int; bestsize int;
  j2len int[]; newj2len int[]; touched int[]; newtouched int[];
  js int[]; j int; k int; i int; t int;
  matched int := 0;
begin
  if la + lb = 0 then return 1.0; end if;
  -- b2j: every position of each token in b, ascending (no junk, autojunk off).
  select coalesce(jsonb_object_agg(tok, pos), '{}'::jsonb) into b2j
    from (select tok, jsonb_agg(n - 1 order by n) pos from unnest(b) with ordinality u(tok, n) group by tok) s;
  todo := array[0, la, 0, lb];
  while coalesce(array_length(todo, 1), 0) > 0 loop
    alo := todo[1]; ahi := todo[2]; blo := todo[3]; bhi := todo[4];
    todo := todo[5:];
    -- find_longest_match(alo, ahi, blo, bhi)
    besti := alo; bestj := blo; bestsize := 0;
    j2len := array_fill(0, array[lb + 1]); touched := '{}';
    for i in alo .. ahi - 1 loop
      newj2len := j2len; newtouched := '{}';
      -- clear last row's lengths (dict semantics: only this row's j's survive)
      foreach t in array touched loop newj2len[t + 1] := 0; end loop;
      select coalesce(array_agg(x::int order by ord), '{}') into js
        from jsonb_array_elements_text(coalesce(b2j -> a[i + 1], '[]'::jsonb)) with ordinality e(x, ord);
      foreach j in array js loop
        continue when j < blo;
        exit when j >= bhi;
        k := (case when j > 0 then j2len[j] else 0 end) + 1;   -- j2len[j-1] lives at index j
        newj2len[j + 1] := k; newtouched := newtouched || j;
        if k > bestsize then besti := i - k + 1; bestj := j - k + 1; bestsize := k; end if;
      end loop;
      j2len := newj2len; touched := newtouched;
    end loop;
    if bestsize > 0 then
      matched := matched + bestsize;
      if alo < besti and blo < bestj then todo := todo || array[alo, besti, blo, bestj]; end if;
      if besti + bestsize < ahi and bestj + bestsize < bhi then todo := todo || array[besti + bestsize, ahi, bestj + bestsize, bhi]; end if;
    end if;
  end loop;
  return 2.0 * matched / (la + lb);
end $$;

-- ARCH's real slot: the Zagreb time most of its posts went out at in the last 90 days (09:00 since late Aug),
-- latest wins a tie. 09:00 when there is no history.
create or replace function public.arch_fill_slot_hm()
returns text language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce((
    select hm from (
      select to_char(coalesce(scheduled_at, published_at) at time zone 'Europe/Zagreb', 'HH24:MI') hm,
             count(*) n, max(published_at) last
        from public.carousel_drafts
       where client_id = 'arch' and published_at > now() - interval '90 days'
       group by 1) s
     order by n desc, last desc limit 1), '09:00')
$$;

-- Why an ARCH draft may or may not be filled into a slot without Davorin (Ivan 27 Oct: only repurposed posts).
-- A repurposed post = tagged a rework (taxonomy.origin 'rework', rework_of = one of Davorin's PUBLISHED posts),
-- in Review, no date, not posted, not taken off his board, and at most 0.40 word overlap with the original.
create or replace function public.arch_fill_check(p_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public, extensions, pg_temp as $$
declare d public.carousel_drafts; o public.carousel_drafts; v_ov numeric; v_veto text;
begin
  select * into d from public.carousel_drafts where id = p_id;
  if d.id is null or d.client_id is distinct from 'arch' then return jsonb_build_object('ok', false, 'reason', 'not_arch'); end if;
  if coalesce(d.taxonomy->>'origin', '') <> 'rework' or coalesce(d.taxonomy->>'rework_of', '') = '' then
    return jsonb_build_object('ok', false, 'reason', 'not_rework'); end if;
  if d.published_at is not null then return jsonb_build_object('ok', false, 'reason', 'posted'); end if;
  if d.status <> 'review' or d.board_archived_at is not null then return jsonb_build_object('ok', false, 'reason', 'not_in_review'); end if;
  if d.scheduled_at is not null then return jsonb_build_object('ok', false, 'reason', 'dated'); end if;
  if length(btrim(coalesce(d.post_body, ''))) = 0 then return jsonb_build_object('ok', false, 'reason', 'no_text'); end if;
  select * into o from public.carousel_drafts
   where id::text = d.taxonomy->>'rework_of' and client_id = 'arch' and published_at is not null;
  if o.id is null then return jsonb_build_object('ok', false, 'reason', 'original_not_posted'); end if;
  -- Davorin's own veto on the board (same events the ARCH publisher reads).
  select ev into v_veto from (
    select case when a.action = 'note' and a.payload ? 'event' then a.payload->>'event' else a.action end ev, a.created_at
      from public.client_board_actions a where a.ref = d.id::text) x
   where ev in ('post_removed', 'post_restored', 'angle_swap', 'angle_swap_undone')
   order by created_at desc limit 1;
  v_ov := public.arch_rework_overlap(d.post_body, o.post_body);
  if v_veto in ('post_removed', 'angle_swap') then
    return jsonb_build_object('ok', false, 'reason', 'removed_by_davorin', 'overlap', v_ov, 'original_id', o.id); end if;
  if v_ov > 0.40 then return jsonb_build_object('ok', false, 'reason', 'overlap', 'overlap', v_ov, 'original_id', o.id); end if;
  return jsonb_build_object('ok', true, 'overlap', v_ov, 'original_id', o.id, 'original_at', o.published_at);
end $$;

-- READ for the "Fill next week" key on Plan > Weeks (ARCH seat). Writes nothing.
create or replace function public.arch_fill_read(p_gate text)
returns jsonb language plpgsql stable security definer set search_path = public, extensions, pg_temp as $$
declare v_offered jsonb := '[]'; v_held jsonb := '[]'; r record; c jsonb; v_waiting int;
begin
  if auth.uid() is null or not public.operator_gate_ok(p_gate) then return jsonb_build_object('ok', false, 'error', 'bad_gate'); end if;
  for r in select d.id, d.title, d.post_body, d.created_at, o.title o_title, o.published_at o_at
             from public.carousel_drafts d
             left join public.carousel_drafts o on o.id::text = d.taxonomy->>'rework_of' and o.client_id = 'arch'
            where d.client_id = 'arch' and d.taxonomy->>'origin' = 'rework'
              and d.status = 'review' and d.published_at is null and d.scheduled_at is null and d.board_archived_at is null
            order by d.created_at loop
    c := public.arch_fill_check(r.id);
    if (c->>'ok')::boolean then
      v_offered := v_offered || jsonb_build_array(jsonb_build_object('id', r.id, 'title', r.title, 'post_body', r.post_body,
        'body_sha256', encode(digest(r.post_body, 'sha256'), 'hex'),
        'overlap', round((c->>'overlap')::numeric, 2), 'original_title', r.o_title, 'original_at', r.o_at));
    else
      v_held := v_held || jsonb_build_array(jsonb_build_object('id', r.id, 'title', r.title, 'reason', c->>'reason',
        'overlap', round((c->>'overlap')::numeric, 2)));
    end if;
  end loop;
  select count(*) into v_waiting from public.carousel_drafts
   where client_id = 'arch' and status = 'review' and published_at is null and scheduled_at is null
     and board_archived_at is null and board_visible is true and coalesce(taxonomy->>'origin', '') <> 'rework';
  return jsonb_build_object('ok', true, 'tz', 'Europe/Zagreb', 'slot_hm', public.arch_fill_slot_hm(), 'limit', 0.40, 'week', public.arch_fill_week(),
    'offered', v_offered, 'held', v_held, 'waiting_davorin', v_waiting);
end $$;

-- ONE ORDER FOR EVERY ARCH APPROVE / UNDO (cross-review r3 + r4). The ARCH publisher trusts the latest approve or
-- undo_approve by created_at. With DEFAULT now() two writes in one transaction tie, and a write whose transaction
-- started earlier can sort behind a later one. So every ARCH approve / undo_approve row (and a board note carrying
-- that event), from any writer (this feature, the board, Claude), is stamped on insert: per post, one at a time
-- (advisory lock on the post), strictly after the newest row already there.
create or replace function public.tg_arch_approval_order()
returns trigger language plpgsql volatile security definer set search_path = public, pg_temp as $$
begin
  perform pg_advisory_xact_lock(hashtext('arch_approval:' || coalesce(new.ref, '')));
  new.created_at := greatest(clock_timestamp(),
    coalesce((select max(created_at) from public.client_board_actions where ref = new.ref), '-infinity') + interval '1 microsecond');
  return new;
end $$;
drop trigger if exists arch_approval_order on public.client_board_actions;
create trigger arch_approval_order before insert on public.client_board_actions
  for each row when (new.client_id = 'arch' and (new.action in ('approve', 'undo_approve')
    or (new.action = 'note' and new.payload->>'event' in ('approve', 'undo_approve'))))
  execute function public.tg_arch_approval_order();

-- The week the key fills: next Monday to Friday in Zagreb, and how many posts that week still takes
-- (content_plan_config.posts_per_week for ARCH, 3 when unset, minus ARCH posts already dated or posted there).
create or replace function public.arch_fill_week(p_now timestamptz default now())
returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
  with d as (select (p_now at time zone 'Europe/Zagreb')::date today),
       w as (select (today + (8 - extract(isodow from today)::int))::date mon from d)
  select jsonb_build_object('start', w.mon, 'end', w.mon + 4,
    'target', coalesce((select posts_per_week from public.content_plan_config where account = 'arch'), 3),
    'dated', (select count(*) from public.carousel_drafts x
               where x.client_id = 'arch'
                 and (coalesce(x.published_at, x.scheduled_at) at time zone 'Europe/Zagreb')::date between w.mon and w.mon + 6
                 and (x.published_at is not null or x.status in ('review', 'scheduled', 'approved'))))
  from w
$$;

-- COMMIT: Ivan's one tap. All or nothing, idempotent on p_batch (the client makes the id before it asks, so a lost
-- response can be retried or undone). Each item {id, at, body_sha256}: the body must still be the one the key
-- showed; re-checks the draft (arch_fill_check), the slot (ARCH's real time on a weekday of next week, still ahead),
-- the week's room left, and 24 h from every other dated ARCH post, all under one ARCH calendar lock. Then writes the
-- same arming the 27 Oct reworks used: an approve row by Ivan with the body sha, board visible, and the date through
-- operator_set_schedule_date (which also rebuilds Davorin's board).
create or replace function public.arch_fill_commit(p_gate text, p_batch uuid, p_items jsonb)
returns jsonb language plpgsql volatile security definer set search_path = public, extensions, pg_temp as $$
declare
  v_slot text := public.arch_fill_slot_hm(); v_week jsonb;
  it jsonb; d public.carousel_drafts; c jsonb; v_at timestamptz; v_ids uuid[] := '{}'; v_ats timestamptz[] := '{}';
  v_res jsonb; v_out jsonb := '[]'; i int; v_prev boolean; v_prev_appr jsonb; v_day date;
begin
  if auth.uid() is null or not public.operator_gate_ok(p_gate) then return jsonb_build_object('ok', false, 'error', 'bad_gate'); end if;
  if p_batch is null or jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) not between 1 and 5 then
    return jsonb_build_object('ok', false, 'error', 'bad_items'); end if;
  perform pg_advisory_xact_lock(hashtext('arch_fill_calendar'));
  -- the same batch again (a retry after a lost answer): report what it wrote, write nothing
  if exists (select 1 from public.client_board_actions where client_id = 'arch' and action = 'approve' and payload->>'batch' = p_batch::text) then
    select coalesce(jsonb_agg(jsonb_build_object('id', ref, 'scheduled_at', payload->'scheduled_at') order by created_at, id), '[]') into v_out
      from public.client_board_actions where client_id = 'arch' and action = 'approve' and payload->>'batch' = p_batch::text;
    return jsonb_build_object('ok', true, 'batch', p_batch, 'items', v_out, 'again', true);
  end if;
  v_week := public.arch_fill_week();
  if (v_week->>'dated')::int + jsonb_array_length(p_items) > (v_week->>'target')::int then
    return jsonb_build_object('ok', false, 'error', 'week_full'); end if;
  -- 1. check everything before writing anything
  for it in select value from jsonb_array_elements(p_items) loop
    begin v_at := (it->>'at')::timestamptz; exception when others then return jsonb_build_object('ok', false, 'error', 'bad_time'); end;
    if v_at is null or (it->>'id') is null then return jsonb_build_object('ok', false, 'error', 'bad_items'); end if;
    select * into d from public.carousel_drafts where id = (it->>'id')::uuid for update;
    c := public.arch_fill_check((it->>'id')::uuid);
    if not (c->>'ok')::boolean then return jsonb_build_object('ok', false, 'error', 'not_eligible', 'id', it->>'id', 'reason', c->>'reason'); end if;
    if (it->>'body_sha256') is distinct from encode(digest(d.post_body, 'sha256'), 'hex') then
      return jsonb_build_object('ok', false, 'error', 'changed', 'id', it->>'id'); end if;
    if d.id = any(v_ids) then return jsonb_build_object('ok', false, 'error', 'bad_items'); end if;
    if v_at < now() + interval '15 minutes' then return jsonb_build_object('ok', false, 'error', 'past_date', 'id', it->>'id'); end if;
    v_day := (v_at at time zone 'Europe/Zagreb')::date;
    if v_day not between (v_week->>'start')::date and (v_week->>'end')::date
       or to_char(v_at at time zone 'Europe/Zagreb', 'HH24:MI') <> v_slot then
      return jsonb_build_object('ok', false, 'error', 'not_arch_slot', 'id', it->>'id', 'slot_hm', v_slot); end if;
    if exists (select 1 from unnest(v_ats) x where abs(extract(epoch from x - v_at)) < 86400) then
      return jsonb_build_object('ok', false, 'error', 'too_close', 'id', it->>'id'); end if;
    if exists (select 1 from public.carousel_drafts x
                where x.client_id = 'arch' and x.id <> d.id
                  and ((x.published_at is not null and abs(extract(epoch from x.published_at - v_at)) < 86400)
                    or (x.published_at is null and x.scheduled_at is not null and x.status in ('review', 'scheduled', 'approved')
                        and abs(extract(epoch from x.scheduled_at - v_at)) < 86400))) then
      return jsonb_build_object('ok', false, 'error', 'too_close', 'id', it->>'id'); end if;
    v_ids := v_ids || d.id; v_ats := v_ats || v_at;
  end loop;
  -- 2. write
  for i in 1 .. array_length(v_ids, 1) loop
    select * into d from public.carousel_drafts where id = v_ids[i];
    c := public.arch_fill_check(d.id);
    v_prev := coalesce(d.board_visible, false);
    -- the approval state before the fill, so Undo can put it back exactly (read under the post's approval lock)
    perform pg_advisory_xact_lock(hashtext('arch_approval:' || d.id::text));
    select jsonb_build_object('action', a.action, 'payload', a.payload) into v_prev_appr from public.client_board_actions a
     where a.ref = d.id::text and (a.action in ('approve', 'undo_approve') or (a.action = 'note' and a.payload->>'event' in ('approve', 'undo_approve')))
     order by a.created_at desc, a.id desc limit 1;
    if not v_prev then update public.carousel_drafts set board_visible = true, updated_at = now() where id = d.id; end if;
    insert into public.client_board_actions (board_slug, client_id, action, ref, payload)
    values ('arch-agency', 'arch', 'approve', d.id::text, jsonb_build_object(
      'by', 'Ivan', 'via', 'inbox fill next week', 'event', 'operator_release_approval',
      'note', 'Repurposed from Davorin''s own published post; word overlap with the original ' || round((c->>'overlap')::numeric, 2) || ' (limit 0.40).',
      'approved_body_sha256', encode(digest(d.post_body, 'sha256'), 'hex'),
      'overlap', round((c->>'overlap')::numeric, 4), 'original_id', c->>'original_id',
      'batch', p_batch, 'scheduled_at', v_ats[i], 'prev_board_visible', v_prev, 'prev_approval', v_prev_appr));
    v_res := public.operator_set_schedule_date(p_gate, d.id, v_ats[i]);
    if not coalesce((v_res->>'ok')::boolean, false) then
      raise exception 'arch_fill_commit: date refused for %: %', d.id, v_res::text;
    end if;
    v_out := v_out || jsonb_build_array(jsonb_build_object('id', d.id, 'scheduled_at', v_res->'scheduled_at'));
  end loop;
  return jsonb_build_object('ok', true, 'batch', p_batch, 'items', v_out);
end $$;

-- UNDO a fill. A post is put back only when nothing moved since the fill: same date, same body, still on the board,
-- the fill's approve still the latest approve/undo, and its time more than 15 minutes away (the publisher polls
-- every 10 minutes, so a post that close may already be on its way). Then: the approval state before the fill is
-- restored (an undo_approve, or the earlier approve copied back), the date cleared, and the post taken off
-- Davorin's board if the fill put it there. Anything else is left alone and counted.
create or replace function public.arch_fill_undo(p_gate text, p_batch uuid)
returns jsonb language plpgsql volatile security definer set search_path = public, extensions, pg_temp as $$
declare a record; d public.carousel_drafts; v_last public.client_board_actions.id%type; v_undone int := 0; v_posted int := 0; v_changed int := 0; v_late int := 0;
  v_found int := 0; v_res jsonb; v_prev jsonb;
begin
  if auth.uid() is null or not public.operator_gate_ok(p_gate) then return jsonb_build_object('ok', false, 'error', 'bad_gate'); end if;
  perform pg_advisory_xact_lock(hashtext('arch_fill_calendar'));
  for a in select * from public.client_board_actions
            where client_id = 'arch' and action = 'approve' and payload->>'batch' = p_batch::text order by created_at, id loop
    v_found := v_found + 1;
    -- the post's approval lock before reading its latest approval, held to the end (review r5): a board approve or
    -- undo still in flight finishes first, so the check below sees it.
    perform pg_advisory_xact_lock(hashtext('arch_approval:' || a.ref));
    select * into d from public.carousel_drafts where id::text = a.ref and client_id = 'arch' for update;
    if d.id is null then v_changed := v_changed + 1; continue; end if;
    if d.published_at is not null then v_posted := v_posted + 1; continue; end if;
    select id into v_last from public.client_board_actions
     where ref = a.ref and (action in ('approve', 'undo_approve') or (action = 'note' and payload->>'event' in ('approve', 'undo_approve')))
     order by created_at desc, id desc limit 1;
    if v_last is distinct from a.id
       or exists (select 1 from public.client_board_actions u where u.ref = a.ref and u.payload->>'undone_batch' = p_batch::text)
       or d.scheduled_at is distinct from (a.payload->>'scheduled_at')::timestamptz
       or encode(digest(coalesce(d.post_body, ''), 'sha256'), 'hex') is distinct from a.payload->>'approved_body_sha256'
       or d.board_visible is not true or d.status <> 'review' then
      v_changed := v_changed + 1; continue; end if;
    if d.scheduled_at <= now() + interval '15 minutes' then v_late := v_late + 1; continue; end if;
    v_prev := a.payload->'prev_approval';
    if v_prev is not null and (v_prev->>'action' = 'approve' or (v_prev->>'action' = 'note' and v_prev->'payload'->>'event' = 'approve')) then
      insert into public.client_board_actions (board_slug, client_id, action, ref, payload)
      values ('arch-agency', 'arch', 'approve', a.ref, coalesce(v_prev->'payload', '{}'::jsonb) - 'batch'
              || jsonb_build_object('restored_by', 'inbox fill next week undo', 'undone_batch', p_batch));
    else
      insert into public.client_board_actions (board_slug, client_id, action, ref, payload)
      values ('arch-agency', 'arch', 'undo_approve', a.ref, jsonb_build_object('by', 'Ivan', 'via', 'inbox fill next week', 'event', 'fill_undo', 'undone_batch', p_batch));
    end if;
    v_res := public.operator_set_schedule_date(p_gate, d.id, null);
    if not coalesce((v_res->>'ok')::boolean, false) then raise exception 'arch_fill_undo: date clear refused for %: %', d.id, v_res::text; end if;
    if (a.payload->>'prev_board_visible')::boolean is false then
      v_res := public.operator_set_board_visible(p_gate, d.id, false);
      if not coalesce((v_res->>'ok')::boolean, false) then raise exception 'arch_fill_undo: board refused for %: %', d.id, v_res::text; end if;
    end if;
    v_undone := v_undone + 1;
  end loop;
  if v_found = 0 then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  return jsonb_build_object('ok', true, 'undone', v_undone, 'posted', v_posted, 'changed', v_changed, 'too_late', v_late);
end $$;

-- A FILLED POST WHOSE TEXT CHANGES LOSES ITS APPROVAL (cross-review r2). The ARCH publisher reads the body at send
-- time and does not compare it with approved_body_sha256, so an edit after the tap (Ivan's editor, Davorin's board,
-- any engine) could post a text that never passed the 0.40 check. When the latest approval is a fill's and the new
-- body no longer matches its hash, an undo_approve goes in: the publisher skips it until it is approved again.
create or replace function public.tg_arch_fill_body_changed()
returns trigger language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare a public.client_board_actions;
begin
  perform pg_advisory_xact_lock(hashtext('arch_approval:' || new.id::text));
  select * into a from public.client_board_actions
   where ref = new.id::text and (action in ('approve', 'undo_approve') or (action = 'note' and payload->>'event' in ('approve', 'undo_approve')))
   order by created_at desc, id desc limit 1;
  if a.action = 'approve' and a.payload->>'via' = 'inbox fill next week'
     and a.payload->>'approved_body_sha256' is distinct from encode(digest(coalesce(new.post_body, ''), 'sha256'), 'hex') then
    insert into public.client_board_actions (board_slug, client_id, action, ref, payload)
    values ('arch-agency', 'arch', 'undo_approve', new.id::text, jsonb_build_object(
      'by', 'system', 'via', 'inbox fill next week', 'event', 'body_changed_after_fill', 'batch_of', a.payload->>'batch',
      'note', 'The text changed after Fill next week approved it, so it waits for a new approval.'));
  end if;
  return null;
end $$;
drop trigger if exists arch_fill_body_changed on public.carousel_drafts;
create trigger arch_fill_body_changed after update of post_body on public.carousel_drafts
  for each row when (new.client_id = 'arch' and new.published_at is null and old.post_body is distinct from new.post_body)
  execute function public.tg_arch_fill_body_changed();

revoke all on function public.tg_arch_fill_body_changed(), public.tg_arch_approval_order(), public.arch_rework_tokens(text), public.arch_rework_overlap(text, text), public.arch_fill_slot_hm(), public.arch_fill_week(timestamptz),
  public.arch_fill_check(uuid), public.arch_fill_read(text), public.arch_fill_commit(text, uuid, jsonb), public.arch_fill_undo(text, uuid) from public, anon;
grant execute on function public.arch_fill_read(text), public.arch_fill_commit(text, uuid, jsonb), public.arch_fill_undo(text, uuid) to authenticated, service_role;
grant execute on function public.arch_rework_tokens(text), public.arch_rework_overlap(text, text), public.arch_fill_slot_hm(), public.arch_fill_week(timestamptz), public.arch_fill_check(uuid) to service_role;
-- Helpers stay server-side (Supabase grants new functions to authenticated by default).
revoke execute on function public.tg_arch_fill_body_changed(), public.tg_arch_approval_order(), public.arch_rework_tokens(text), public.arch_rework_overlap(text, text), public.arch_fill_slot_hm(), public.arch_fill_week(timestamptz), public.arch_fill_check(uuid) from authenticated;
