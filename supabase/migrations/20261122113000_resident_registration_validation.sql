-- Staff registration is a complete, in-person verification workflow. Clinical
-- intake and household capture intentionally permit incomplete demographics.
-- Do not backfill, merge, or add an identity unique index to historical rows.
begin;

create or replace function public.normalize_resident_registration_name(p_value text)
returns text language sql immutable set search_path = pg_catalog
as $$
  select regexp_replace(normalize(btrim(coalesce(p_value, ''),
    E' \t\n\r\v\f' || U&'\00a0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200a\2028\2029\202f\205f\3000\feff'), NFC), ' +', ' ', 'g');
$$;

create or replace function public.resident_registration_name_is_valid(p_value text)
returns boolean language plpgsql immutable set search_path = pg_catalog
as $$
declare
  -- Unicode 16.0 L/M ranges, matching shared/residentRegistration.js. Locale
  -- [:alpha:] both omits combining marks and admits non-letter number/symbols.
  letters_marks constant text :=
    U&'[\0041-\005a\0061-\007a\00aa\00b5\00ba\00c0-\00d6\00d8-\00f6\00f8-\02c1\02c6-\02d1\02e0-\02e4\02ec\02ee\0300-\0374\0376-\0377\037a-\037d\037f\0386\0388-\038a\038c' ||
    U&'\038e-\03a1\03a3-\03f5\03f7-\0481\0483-\052f\0531-\0556\0559\0560-\0588\0591-\05bd\05bf\05c1-\05c2\05c4-\05c5\05c7\05d0-\05ea\05ef-\05f2\0610-\061a\0620-\065f\066e-\06d3' ||
    U&'\06d5-\06dc\06df-\06e8\06ea-\06ef\06fa-\06fc\06ff\0710-\074a\074d-\07b1\07ca-\07f5\07fa\07fd\0800-\082d\0840-\085b\0860-\086a\0870-\0887\0889-\088e\0897-\08e1\08e3-\0963' ||
    U&'\0971-\0983\0985-\098c\098f-\0990\0993-\09a8\09aa-\09b0\09b2\09b6-\09b9\09bc-\09c4\09c7-\09c8\09cb-\09ce\09d7\09dc-\09dd\09df-\09e3\09f0-\09f1\09fc\09fe\0a01-\0a03' ||
    U&'\0a05-\0a0a\0a0f-\0a10\0a13-\0a28\0a2a-\0a30\0a32-\0a33\0a35-\0a36\0a38-\0a39\0a3c\0a3e-\0a42\0a47-\0a48\0a4b-\0a4d\0a51\0a59-\0a5c\0a5e\0a70-\0a75\0a81-\0a83\0a85-\0a8d' ||
    U&'\0a8f-\0a91\0a93-\0aa8\0aaa-\0ab0\0ab2-\0ab3\0ab5-\0ab9\0abc-\0ac5\0ac7-\0ac9\0acb-\0acd\0ad0\0ae0-\0ae3\0af9-\0aff\0b01-\0b03\0b05-\0b0c\0b0f-\0b10\0b13-\0b28\0b2a-\0b30' ||
    U&'\0b32-\0b33\0b35-\0b39\0b3c-\0b44\0b47-\0b48\0b4b-\0b4d\0b55-\0b57\0b5c-\0b5d\0b5f-\0b63\0b71\0b82-\0b83\0b85-\0b8a\0b8e-\0b90\0b92-\0b95\0b99-\0b9a\0b9c\0b9e-\0b9f' ||
    U&'\0ba3-\0ba4\0ba8-\0baa\0bae-\0bb9\0bbe-\0bc2\0bc6-\0bc8\0bca-\0bcd\0bd0\0bd7\0c00-\0c0c\0c0e-\0c10\0c12-\0c28\0c2a-\0c39\0c3c-\0c44\0c46-\0c48\0c4a-\0c4d\0c55-\0c56' ||
    U&'\0c58-\0c5a\0c5d\0c60-\0c63\0c80-\0c83\0c85-\0c8c\0c8e-\0c90\0c92-\0ca8\0caa-\0cb3\0cb5-\0cb9\0cbc-\0cc4\0cc6-\0cc8\0cca-\0ccd\0cd5-\0cd6\0cdd-\0cde\0ce0-\0ce3\0cf1-\0cf3' ||
    U&'\0d00-\0d0c\0d0e-\0d10\0d12-\0d44\0d46-\0d48\0d4a-\0d4e\0d54-\0d57\0d5f-\0d63\0d7a-\0d7f\0d81-\0d83\0d85-\0d96\0d9a-\0db1\0db3-\0dbb\0dbd\0dc0-\0dc6\0dca\0dcf-\0dd4\0dd6' ||
    U&'\0dd8-\0ddf\0df2-\0df3\0e01-\0e3a\0e40-\0e4e\0e81-\0e82\0e84\0e86-\0e8a\0e8c-\0ea3\0ea5\0ea7-\0ebd\0ec0-\0ec4\0ec6\0ec8-\0ece\0edc-\0edf\0f00\0f18-\0f19\0f35\0f37\0f39' ||
    U&'\0f3e-\0f47\0f49-\0f6c\0f71-\0f84\0f86-\0f97\0f99-\0fbc\0fc6\1000-\103f\1050-\108f\109a-\109d\10a0-\10c5\10c7\10cd\10d0-\10fa\10fc-\1248\124a-\124d\1250-\1256\1258' ||
    U&'\125a-\125d\1260-\1288\128a-\128d\1290-\12b0\12b2-\12b5\12b8-\12be\12c0\12c2-\12c5\12c8-\12d6\12d8-\1310\1312-\1315\1318-\135a\135d-\135f\1380-\138f\13a0-\13f5\13f8-\13fd' ||
    U&'\1401-\166c\166f-\167f\1681-\169a\16a0-\16ea\16f1-\16f8\1700-\1715\171f-\1734\1740-\1753\1760-\176c\176e-\1770\1772-\1773\1780-\17d3\17d7\17dc-\17dd\180b-\180d\180f' ||
    U&'\1820-\1878\1880-\18aa\18b0-\18f5\1900-\191e\1920-\192b\1930-\193b\1950-\196d\1970-\1974\1980-\19ab\19b0-\19c9\1a00-\1a1b\1a20-\1a5e\1a60-\1a7c\1a7f\1aa7\1ab0-\1ace' ||
    U&'\1b00-\1b4c\1b6b-\1b73\1b80-\1baf\1bba-\1bf3\1c00-\1c37\1c4d-\1c4f\1c5a-\1c7d\1c80-\1c8a\1c90-\1cba\1cbd-\1cbf\1cd0-\1cd2\1cd4-\1cfa\1d00-\1f15\1f18-\1f1d\1f20-\1f45' ||
    U&'\1f48-\1f4d\1f50-\1f57\1f59\1f5b\1f5d\1f5f-\1f7d\1f80-\1fb4\1fb6-\1fbc\1fbe\1fc2-\1fc4\1fc6-\1fcc\1fd0-\1fd3\1fd6-\1fdb\1fe0-\1fec\1ff2-\1ff4\1ff6-\1ffc\2071\207f' ||
    U&'\2090-\209c\20d0-\20f0\2102\2107\210a-\2113\2115\2119-\211d\2124\2126\2128\212a-\212d\212f-\2139\213c-\213f\2145-\2149\214e\2183-\2184\2c00-\2ce4\2ceb-\2cf3\2d00-\2d25' ||
    U&'\2d27\2d2d\2d30-\2d67\2d6f\2d7f-\2d96\2da0-\2da6\2da8-\2dae\2db0-\2db6\2db8-\2dbe\2dc0-\2dc6\2dc8-\2dce\2dd0-\2dd6\2dd8-\2dde\2de0-\2dff\2e2f\3005-\3006\302a-\302f' ||
    U&'\3031-\3035\303b-\303c\3041-\3096\3099-\309a\309d-\309f\30a1-\30fa\30fc-\30ff\3105-\312f\3131-\318e\31a0-\31bf\31f0-\31ff\3400-\4dbf\4e00-\a48c\a4d0-\a4fd\a500-\a60c' ||
    U&'\a610-\a61f\a62a-\a62b\a640-\a672\a674-\a67d\a67f-\a6e5\a6f0-\a6f1\a717-\a71f\a722-\a788\a78b-\a7cd\a7d0-\a7d1\a7d3\a7d5-\a7dc\a7f2-\a827\a82c\a840-\a873\a880-\a8c5' ||
    U&'\a8e0-\a8f7\a8fb\a8fd-\a8ff\a90a-\a92d\a930-\a953\a960-\a97c\a980-\a9c0\a9cf\a9e0-\a9ef\a9fa-\a9fe\aa00-\aa36\aa40-\aa4d\aa60-\aa76\aa7a-\aac2\aadb-\aadd\aae0-\aaef' ||
    U&'\aaf2-\aaf6\ab01-\ab06\ab09-\ab0e\ab11-\ab16\ab20-\ab26\ab28-\ab2e\ab30-\ab5a\ab5c-\ab69\ab70-\abea\abec-\abed\ac00-\d7a3\d7b0-\d7c6\d7cb-\d7fb\f900-\fa6d\fa70-\fad9' ||
    U&'\fb00-\fb06\fb13-\fb17\fb1d-\fb28\fb2a-\fb36\fb38-\fb3c\fb3e\fb40-\fb41\fb43-\fb44\fb46-\fbb1\fbd3-\fd3d\fd50-\fd8f\fd92-\fdc7\fdf0-\fdfb\fe00-\fe0f\fe20-\fe2f\fe70-\fe74' ||
    U&'\fe76-\fefc\ff21-\ff3a\ff41-\ff5a\ff66-\ffbe\ffc2-\ffc7\ffca-\ffcf\ffd2-\ffd7\ffda-\ffdc\+010000-\+01000b\+01000d-\+010026\+010028-\+01003a\+01003c-\+01003d' ||
    U&'\+01003f-\+01004d\+010050-\+01005d\+010080-\+0100fa\+0101fd\+010280-\+01029c\+0102a0-\+0102d0\+0102e0\+010300-\+01031f\+01032d-\+010340\+010342-\+010349\+010350-\+01037a' ||
    U&'\+010380-\+01039d\+0103a0-\+0103c3\+0103c8-\+0103cf\+010400-\+01049d\+0104b0-\+0104d3\+0104d8-\+0104fb\+010500-\+010527\+010530-\+010563\+010570-\+01057a\+01057c-\+01058a' ||
    U&'\+01058c-\+010592\+010594-\+010595\+010597-\+0105a1\+0105a3-\+0105b1\+0105b3-\+0105b9\+0105bb-\+0105bc\+0105c0-\+0105f3\+010600-\+010736\+010740-\+010755\+010760-\+010767' ||
    U&'\+010780-\+010785\+010787-\+0107b0\+0107b2-\+0107ba\+010800-\+010805\+010808\+01080a-\+010835\+010837-\+010838\+01083c\+01083f-\+010855\+010860-\+010876\+010880-\+01089e' ||
    U&'\+0108e0-\+0108f2\+0108f4-\+0108f5\+010900-\+010915\+010920-\+010939\+010980-\+0109b7\+0109be-\+0109bf\+010a00-\+010a03\+010a05-\+010a06\+010a0c-\+010a13\+010a15-\+010a17' ||
    U&'\+010a19-\+010a35\+010a38-\+010a3a\+010a3f\+010a60-\+010a7c\+010a80-\+010a9c\+010ac0-\+010ac7\+010ac9-\+010ae6\+010b00-\+010b35\+010b40-\+010b55\+010b60-\+010b72' ||
    U&'\+010b80-\+010b91\+010c00-\+010c48\+010c80-\+010cb2\+010cc0-\+010cf2\+010d00-\+010d27\+010d4a-\+010d65\+010d69-\+010d6d\+010d6f-\+010d85\+010e80-\+010ea9\+010eab-\+010eac' ||
    U&'\+010eb0-\+010eb1\+010ec2-\+010ec4\+010efc-\+010f1c\+010f27\+010f30-\+010f50\+010f70-\+010f85\+010fb0-\+010fc4\+010fe0-\+010ff6\+011000-\+011046\+011070-\+011075' ||
    U&'\+01107f-\+0110ba\+0110c2\+0110d0-\+0110e8\+011100-\+011134\+011144-\+011147\+011150-\+011173\+011176\+011180-\+0111c4\+0111c9-\+0111cc\+0111ce-\+0111cf\+0111da\+0111dc' ||
    U&'\+011200-\+011211\+011213-\+011237\+01123e-\+011241\+011280-\+011286\+011288\+01128a-\+01128d\+01128f-\+01129d\+01129f-\+0112a8\+0112b0-\+0112ea\+011300-\+011303' ||
    U&'\+011305-\+01130c\+01130f-\+011310\+011313-\+011328\+01132a-\+011330\+011332-\+011333\+011335-\+011339\+01133b-\+011344\+011347-\+011348\+01134b-\+01134d\+011350\+011357' ||
    U&'\+01135d-\+011363\+011366-\+01136c\+011370-\+011374\+011380-\+011389\+01138b\+01138e\+011390-\+0113b5\+0113b7-\+0113c0\+0113c2\+0113c5\+0113c7-\+0113ca\+0113cc-\+0113d3' ||
    U&'\+0113e1-\+0113e2\+011400-\+01144a\+01145e-\+011461\+011480-\+0114c5\+0114c7\+011580-\+0115b5\+0115b8-\+0115c0\+0115d8-\+0115dd\+011600-\+011640\+011644\+011680-\+0116b8' ||
    U&'\+011700-\+01171a\+01171d-\+01172b\+011740-\+011746\+011800-\+01183a\+0118a0-\+0118df\+0118ff-\+011906\+011909\+01190c-\+011913\+011915-\+011916\+011918-\+011935' ||
    U&'\+011937-\+011938\+01193b-\+011943\+0119a0-\+0119a7\+0119aa-\+0119d7\+0119da-\+0119e1\+0119e3-\+0119e4\+011a00-\+011a3e\+011a47\+011a50-\+011a99\+011a9d\+011ab0-\+011af8' ||
    U&'\+011bc0-\+011be0\+011c00-\+011c08\+011c0a-\+011c36\+011c38-\+011c40\+011c72-\+011c8f\+011c92-\+011ca7\+011ca9-\+011cb6\+011d00-\+011d06\+011d08-\+011d09\+011d0b-\+011d36' ||
    U&'\+011d3a\+011d3c-\+011d3d\+011d3f-\+011d47\+011d60-\+011d65\+011d67-\+011d68\+011d6a-\+011d8e\+011d90-\+011d91\+011d93-\+011d98\+011ee0-\+011ef6\+011f00-\+011f10' ||
    U&'\+011f12-\+011f3a\+011f3e-\+011f42\+011f5a\+011fb0\+012000-\+012399\+012480-\+012543\+012f90-\+012ff0\+013000-\+01342f\+013440-\+013455\+013460-\+0143fa\+014400-\+014646' ||
    U&'\+016100-\+01612f\+016800-\+016a38\+016a40-\+016a5e\+016a70-\+016abe\+016ad0-\+016aed\+016af0-\+016af4\+016b00-\+016b36\+016b40-\+016b43\+016b63-\+016b77\+016b7d-\+016b8f' ||
    U&'\+016d40-\+016d6c\+016e40-\+016e7f\+016f00-\+016f4a\+016f4f-\+016f87\+016f8f-\+016f9f\+016fe0-\+016fe1\+016fe3-\+016fe4\+016ff0-\+016ff1\+017000-\+0187f7\+018800-\+018cd5' ||
    U&'\+018cff-\+018d08\+01aff0-\+01aff3\+01aff5-\+01affb\+01affd-\+01affe\+01b000-\+01b122\+01b132\+01b150-\+01b152\+01b155\+01b164-\+01b167\+01b170-\+01b2fb\+01bc00-\+01bc6a' ||
    U&'\+01bc70-\+01bc7c\+01bc80-\+01bc88\+01bc90-\+01bc99\+01bc9d-\+01bc9e\+01cf00-\+01cf2d\+01cf30-\+01cf46\+01d165-\+01d169\+01d16d-\+01d172\+01d17b-\+01d182\+01d185-\+01d18b' ||
    U&'\+01d1aa-\+01d1ad\+01d242-\+01d244\+01d400-\+01d454\+01d456-\+01d49c\+01d49e-\+01d49f\+01d4a2\+01d4a5-\+01d4a6\+01d4a9-\+01d4ac\+01d4ae-\+01d4b9\+01d4bb\+01d4bd-\+01d4c3' ||
    U&'\+01d4c5-\+01d505\+01d507-\+01d50a\+01d50d-\+01d514\+01d516-\+01d51c\+01d51e-\+01d539\+01d53b-\+01d53e\+01d540-\+01d544\+01d546\+01d54a-\+01d550\+01d552-\+01d6a5' ||
    U&'\+01d6a8-\+01d6c0\+01d6c2-\+01d6da\+01d6dc-\+01d6fa\+01d6fc-\+01d714\+01d716-\+01d734\+01d736-\+01d74e\+01d750-\+01d76e\+01d770-\+01d788\+01d78a-\+01d7a8\+01d7aa-\+01d7c2' ||
    U&'\+01d7c4-\+01d7cb\+01da00-\+01da36\+01da3b-\+01da6c\+01da75\+01da84\+01da9b-\+01da9f\+01daa1-\+01daaf\+01df00-\+01df1e\+01df25-\+01df2a\+01e000-\+01e006\+01e008-\+01e018' ||
    U&'\+01e01b-\+01e021\+01e023-\+01e024\+01e026-\+01e02a\+01e030-\+01e06d\+01e08f\+01e100-\+01e12c\+01e130-\+01e13d\+01e14e\+01e290-\+01e2ae\+01e2c0-\+01e2ef\+01e4d0-\+01e4ef' ||
    U&'\+01e5d0-\+01e5f0\+01e7e0-\+01e7e6\+01e7e8-\+01e7eb\+01e7ed-\+01e7ee\+01e7f0-\+01e7fe\+01e800-\+01e8c4\+01e8d0-\+01e8d6\+01e900-\+01e94b\+01ee00-\+01ee03\+01ee05-\+01ee1f' ||
    U&'\+01ee21-\+01ee22\+01ee24\+01ee27\+01ee29-\+01ee32\+01ee34-\+01ee37\+01ee39\+01ee3b\+01ee42\+01ee47\+01ee49\+01ee4b\+01ee4d-\+01ee4f\+01ee51-\+01ee52\+01ee54\+01ee57' ||
    U&'\+01ee59\+01ee5b\+01ee5d\+01ee5f\+01ee61-\+01ee62\+01ee64\+01ee67-\+01ee6a\+01ee6c-\+01ee72\+01ee74-\+01ee77\+01ee79-\+01ee7c\+01ee7e\+01ee80-\+01ee89\+01ee8b-\+01ee9b' ||
    U&'\+01eea1-\+01eea3\+01eea5-\+01eea9\+01eeab-\+01eebb\+020000-\+02a6df\+02a700-\+02b739\+02b740-\+02b81d\+02b820-\+02cea1\+02ceb0-\+02ebe0\+02ebf0-\+02ee5d\+02f800-\+02fa1d' ||
    U&'\+030000-\+03134a\+031350-\+0323af\+0e0100-\+0e01ef]';
  marks constant text :=
    U&'[\0300-\036f\0483-\0489\0591-\05bd\05bf\05c1-\05c2\05c4-\05c5\05c7\0610-\061a\064b-\065f\0670\06d6-\06dc\06df-\06e4\06e7-\06e8\06ea-\06ed\0711\0730-\074a\07a6-\07b0' ||
    U&'\07eb-\07f3\07fd\0816-\0819\081b-\0823\0825-\0827\0829-\082d\0859-\085b\0897-\089f\08ca-\08e1\08e3-\0903\093a-\093c\093e-\094f\0951-\0957\0962-\0963\0981-\0983\09bc' ||
    U&'\09be-\09c4\09c7-\09c8\09cb-\09cd\09d7\09e2-\09e3\09fe\0a01-\0a03\0a3c\0a3e-\0a42\0a47-\0a48\0a4b-\0a4d\0a51\0a70-\0a71\0a75\0a81-\0a83\0abc\0abe-\0ac5\0ac7-\0ac9' ||
    U&'\0acb-\0acd\0ae2-\0ae3\0afa-\0aff\0b01-\0b03\0b3c\0b3e-\0b44\0b47-\0b48\0b4b-\0b4d\0b55-\0b57\0b62-\0b63\0b82\0bbe-\0bc2\0bc6-\0bc8\0bca-\0bcd\0bd7\0c00-\0c04\0c3c' ||
    U&'\0c3e-\0c44\0c46-\0c48\0c4a-\0c4d\0c55-\0c56\0c62-\0c63\0c81-\0c83\0cbc\0cbe-\0cc4\0cc6-\0cc8\0cca-\0ccd\0cd5-\0cd6\0ce2-\0ce3\0cf3\0d00-\0d03\0d3b-\0d3c\0d3e-\0d44' ||
    U&'\0d46-\0d48\0d4a-\0d4d\0d57\0d62-\0d63\0d81-\0d83\0dca\0dcf-\0dd4\0dd6\0dd8-\0ddf\0df2-\0df3\0e31\0e34-\0e3a\0e47-\0e4e\0eb1\0eb4-\0ebc\0ec8-\0ece\0f18-\0f19\0f35\0f37' ||
    U&'\0f39\0f3e-\0f3f\0f71-\0f84\0f86-\0f87\0f8d-\0f97\0f99-\0fbc\0fc6\102b-\103e\1056-\1059\105e-\1060\1062-\1064\1067-\106d\1071-\1074\1082-\108d\108f\109a-\109d\135d-\135f' ||
    U&'\1712-\1715\1732-\1734\1752-\1753\1772-\1773\17b4-\17d3\17dd\180b-\180d\180f\1885-\1886\18a9\1920-\192b\1930-\193b\1a17-\1a1b\1a55-\1a5e\1a60-\1a7c\1a7f\1ab0-\1ace' ||
    U&'\1b00-\1b04\1b34-\1b44\1b6b-\1b73\1b80-\1b82\1ba1-\1bad\1be6-\1bf3\1c24-\1c37\1cd0-\1cd2\1cd4-\1ce8\1ced\1cf4\1cf7-\1cf9\1dc0-\1dff\20d0-\20f0\2cef-\2cf1\2d7f\2de0-\2dff' ||
    U&'\302a-\302f\3099-\309a\a66f-\a672\a674-\a67d\a69e-\a69f\a6f0-\a6f1\a802\a806\a80b\a823-\a827\a82c\a880-\a881\a8b4-\a8c5\a8e0-\a8f1\a8ff\a926-\a92d\a947-\a953\a980-\a983' ||
    U&'\a9b3-\a9c0\a9e5\aa29-\aa36\aa43\aa4c-\aa4d\aa7b-\aa7d\aab0\aab2-\aab4\aab7-\aab8\aabe-\aabf\aac1\aaeb-\aaef\aaf5-\aaf6\abe3-\abea\abec-\abed\fb1e\fe00-\fe0f\fe20-\fe2f' ||
    U&'\+0101fd\+0102e0\+010376-\+01037a\+010a01-\+010a03\+010a05-\+010a06\+010a0c-\+010a0f\+010a38-\+010a3a\+010a3f\+010ae5-\+010ae6\+010d24-\+010d27\+010d69-\+010d6d' ||
    U&'\+010eab-\+010eac\+010efc-\+010eff\+010f46-\+010f50\+010f82-\+010f85\+011000-\+011002\+011038-\+011046\+011070\+011073-\+011074\+01107f-\+011082\+0110b0-\+0110ba\+0110c2' ||
    U&'\+011100-\+011102\+011127-\+011134\+011145-\+011146\+011173\+011180-\+011182\+0111b3-\+0111c0\+0111c9-\+0111cc\+0111ce-\+0111cf\+01122c-\+011237\+01123e\+011241' ||
    U&'\+0112df-\+0112ea\+011300-\+011303\+01133b-\+01133c\+01133e-\+011344\+011347-\+011348\+01134b-\+01134d\+011357\+011362-\+011363\+011366-\+01136c\+011370-\+011374' ||
    U&'\+0113b8-\+0113c0\+0113c2\+0113c5\+0113c7-\+0113ca\+0113cc-\+0113d0\+0113d2\+0113e1-\+0113e2\+011435-\+011446\+01145e\+0114b0-\+0114c3\+0115af-\+0115b5\+0115b8-\+0115c0' ||
    U&'\+0115dc-\+0115dd\+011630-\+011640\+0116ab-\+0116b7\+01171d-\+01172b\+01182c-\+01183a\+011930-\+011935\+011937-\+011938\+01193b-\+01193e\+011940\+011942-\+011943' ||
    U&'\+0119d1-\+0119d7\+0119da-\+0119e0\+0119e4\+011a01-\+011a0a\+011a33-\+011a39\+011a3b-\+011a3e\+011a47\+011a51-\+011a5b\+011a8a-\+011a99\+011c2f-\+011c36\+011c38-\+011c3f' ||
    U&'\+011c92-\+011ca7\+011ca9-\+011cb6\+011d31-\+011d36\+011d3a\+011d3c-\+011d3d\+011d3f-\+011d45\+011d47\+011d8a-\+011d8e\+011d90-\+011d91\+011d93-\+011d97\+011ef3-\+011ef6' ||
    U&'\+011f00-\+011f01\+011f03\+011f34-\+011f3a\+011f3e-\+011f42\+011f5a\+013440\+013447-\+013455\+01611e-\+01612f\+016af0-\+016af4\+016b30-\+016b36\+016f4f\+016f51-\+016f87' ||
    U&'\+016f8f-\+016f92\+016fe4\+016ff0-\+016ff1\+01bc9d-\+01bc9e\+01cf00-\+01cf2d\+01cf30-\+01cf46\+01d165-\+01d169\+01d16d-\+01d172\+01d17b-\+01d182\+01d185-\+01d18b' ||
    U&'\+01d1aa-\+01d1ad\+01d242-\+01d244\+01da00-\+01da36\+01da3b-\+01da6c\+01da75\+01da84\+01da9b-\+01da9f\+01daa1-\+01daaf\+01e000-\+01e006\+01e008-\+01e018\+01e01b-\+01e021' ||
    U&'\+01e023-\+01e024\+01e026-\+01e02a\+01e08f\+01e130-\+01e136\+01e2ae\+01e2ec-\+01e2ef\+01e4ec-\+01e4ef\+01e5ee-\+01e5ef\+01e8d0-\+01e8d6\+01e944-\+01e94a\+0e0100-\+0e01ef]';
  word_pattern text := letters_marks || '+(?:[.]' || letters_marks || '+)*[.]?';
begin
  return p_value collate "C" ~ ('^' || word_pattern || '(?:[ ' || chr(39) || U&'\2019' || '-]' || word_pattern || ')*$')
    and p_value collate "C" !~ ('(^|[ .' || chr(39) || U&'\2019' || '-])' || marks);
end;
$$;

create or replace function public.resident_registration_text(
  p_value text, p_field text, p_max integer, p_name boolean default false, p_required boolean default false
)
returns text language plpgsql immutable set search_path = pg_catalog, public
as $$
declare
  value text := case when p_name then public.normalize_resident_registration_name(p_value)
    else btrim(coalesce(p_value, ''), E' \t\n\r\v\f' || U&'\00a0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200a\2028\2029\202f\205f\3000\feff') end;
  problem text;
begin
  if p_required and value = '' then problem := 'This field is required.';
  elsif coalesce(p_value, '') ~ E'[\001-\037\177]' then problem := 'This field contains invalid control characters.';
  -- Shared JavaScript bounds count supplementary Unicode characters twice.
  elsif length(value) + length(regexp_replace(value collate "C", U&'[^\+010000-\+10ffff]', '', 'g')) > p_max then
    problem := 'This field is too long (max ' || p_max || ' characters).';
  elsif p_name and value <> '' and not public.resident_registration_name_is_valid(value) then
    problem := 'Use letters, spaces, hyphens, apostrophes, and periods only.';
  end if;
  if problem is not null then
    raise exception using errcode = '22023', message = 'Invalid resident registration field.',
      detail = jsonb_build_object(p_field, problem)::text;
  end if;
  return value;
end;
$$;

create or replace function public.resident_registration_mobile(p_value text)
returns text language plpgsql immutable set search_path = pg_catalog, public
as $$
declare value text;
begin
  if coalesce(p_value, '') ~ E'[\001-\037\177]' then return null; end if;
  value := regexp_replace(public.normalize_resident_registration_name(p_value), '[ -]', '', 'g');
  if value = '' or value ~ '^09[0-9]{9}$' then return value; end if;
  if value ~ '^\+639[0-9]{9}$' then return '0' || substr(value, 4); end if;
  return null;
end;
$$;

create or replace function public.resident_registration_birth_date(p_value text, p_required boolean default false)
returns date language plpgsql stable set search_path = pg_catalog
as $$
declare
  value date;
  today date := (transaction_timestamp() at time zone 'Asia/Manila')::date;
  problem text;
begin
  if p_value is null or p_value = '' then
    if not p_required then return null; end if;
    problem := 'Date of birth is required.';
  elsif p_value !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
    problem := 'Enter a valid date of birth with a four-digit year.';
  else
    begin
      value := make_date(substr(p_value, 1, 4)::integer, substr(p_value, 6, 2)::integer, substr(p_value, 9, 2)::integer);
    exception when datetime_field_overflow then
      problem := 'Enter a valid calendar date of birth.';
    end;
    if problem is null then
      if value > today then problem := 'Date of birth cannot be in the future.';
      elsif extract(year from age(today, value)) not between 0 and 120 then
        problem := 'Date of birth must represent an age from 0 to 120.';
      end if;
    end if;
  end if;
  if problem is not null then
    raise exception using errcode = '22023', message = 'Invalid resident date of birth.',
      detail = jsonb_build_object('birthDate', problem)::text;
  end if;
  return value;
end;
$$;

create or replace function public.guard_resident_registration_fields()
returns trigger language plpgsql security definer set search_path = pg_catalog, public
as $$
declare
  incoming jsonb := to_jsonb(new);
  previous jsonb := case when tg_op = 'UPDATE' then to_jsonb(old) else '{}'::jsonb end;
  field record;
  value text;
  choices text[];
begin
  for field in select * from (values
    ('first_name', 'firstName', 80, true, true), ('middle_name', 'middleName', 80, true, false),
    ('last_name', 'lastName', 80, true, false), ('father_name', 'fatherName', 120, true, false),
    ('mother_name', 'motherName', 120, true, false), ('birth_place', 'birthPlace', 120, false, false),
    ('religion', 'religion', 120, false, false), ('employment_status', 'employmentStatus', 120, false, false),
    ('current_address', 'currentAddress', 300, false, false), ('permanent_address', 'permanentAddress', 300, false, false),
    ('philhealth_no', 'philhealthNo', 40, false, false), ('identity_no', 'identityNo', 60, false, false)
  ) as config(db_field, api_field, max_length, is_name, is_required) loop
    if tg_op = 'UPDATE' and incoming -> field.db_field is not distinct from previous -> field.db_field then continue; end if;
    value := public.resident_registration_text(incoming ->> field.db_field, field.api_field,
      field.max_length, field.is_name, field.is_required);
    new := jsonb_populate_record(new, jsonb_build_object(field.db_field, value));
  end loop;

  for field in select * from (values ('suffix', 'suffix'), ('sex', 'sex'), ('civil_status', 'civilStatus'))
    as config(db_field, api_field) loop
    if tg_op = 'UPDATE' and incoming -> field.db_field is not distinct from previous -> field.db_field then continue; end if;
    value := public.resident_registration_text(incoming ->> field.db_field, field.api_field, 10);
    choices := case field.db_field
      when 'suffix' then array['', 'Jr.', 'Sr.', 'II', 'III', 'IV', 'V']
      when 'sex' then array['', 'Male', 'Female', 'Other']
      else array['', 'Single', 'Married', 'Widowed', 'Separated'] end;
    if not value = any(choices) then
      raise exception using errcode = '22023', message = 'Invalid resident registration field.',
        detail = jsonb_build_object(field.api_field, 'Choose a supported value.')::text;
    end if;
    new := jsonb_populate_record(new, jsonb_build_object(field.db_field, value));
  end loop;

  if tg_op = 'INSERT' or new.cellphone_no is distinct from old.cellphone_no then
    value := public.resident_registration_mobile(new.cellphone_no);
    if value is null then
      raise exception using errcode = '22023', message = 'Invalid resident mobile number.',
        detail = '{"cellphoneNo":"Enter a Philippine mobile number: 09XXXXXXXXX or +639XXXXXXXXX."}';
    end if;
    new.cellphone_no := value;
  end if;
  if tg_op = 'INSERT' or new.birth_date is distinct from old.birth_date or new.age is distinct from old.age then
    new.birth_date := public.resident_registration_birth_date(new.birth_date::text);
    if new.birth_date is not null then
      new.age := extract(year from age((transaction_timestamp() at time zone 'Asia/Manila')::date, new.birth_date))::integer;
    elsif new.age is not null and new.age not between 0 and 120 then
      raise exception using errcode = '22023', message = 'Invalid resident age.', detail = '{"age":"Age must be from 0 to 120."}';
    end if;
  end if;
  if (tg_op = 'INSERT' or new.zone is distinct from old.zone) and new.zone is not null and new.zone not between 1 and 8 then
    raise exception using errcode = '22023', message = 'Invalid resident zone.', detail = '{"zone":"Select a zone from 1 to 8."}';
  end if;
  return new;
end;
$$;

-- NOT VALID checks still recheck every UPDATE. Change-aware guards preserve
-- unchanged old contact/age values during approvals, claims, risk and transfers.
alter table public.residents drop constraint if exists residents_cellphone_no_format;

alter table public.residents drop constraint if exists residents_age_valid;

-- Intake explicitly supports mononyms; the complete staff RPC below still
-- requires a last name. Keep the original first-name and all other constraints.
alter table public.residents drop constraint if exists residents_last_name_not_blank;

drop trigger if exists residents_registration_fields_guard on public.residents;

create trigger residents_registration_fields_guard before insert or update on public.residents
  for each row execute function public.guard_resident_registration_fields();

-- All application resident creation goes through the trusted API. Keep direct
-- SELECT/UPDATE policies and the restrictive personnel session fence intact.
drop policy if exists residents_insert on public.residents;

revoke insert on public.residents from public, anon, authenticated;

grant insert on public.residents to service_role;

create or replace function public.register_staff_resident(p_actor_id uuid, p_resident jsonb)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public
as $$
declare
  actor public.profiles%rowtype;
  personnel public.personnel_accounts%rowtype;
  barangay_row public.barangays%rowtype;
  invited_profile public.profiles%rowtype;
  resident_row public.residents%rowtype;
  existing_row public.residents%rowtype;
  field record;
  value text;
  payload jsonb := '{}'::jsonb;
  existing_payload jsonb;
  requested_barangay uuid;
  requested_municipality uuid;
  invited_user uuid;
  operation_key text;
  dob date;
  completed_age integer;
  is_minor boolean;
  saved_at timestamptz := transaction_timestamp();
  fields constant jsonb := '{
    "id":"id", "health_record_no":"healthRecordNo", "first_name":"firstName", "middle_name":"middleName", "last_name":"lastName",
    "suffix":"suffix", "birth_date":"birthDate", "age":"age", "birth_place":"birthPlace", "sex":"sex", "civil_status":"civilStatus",
    "religion":"religion", "employment_status":"employmentStatus", "father_name":"fatherName", "mother_name":"motherName",
    "is_4ps_member":"is4PsMember", "philhealth_no":"philhealthNo", "current_address":"currentAddress", "permanent_address":"permanentAddress",
    "cellphone_no":"cellphoneNo", "identity_no":"identityNo", "zone":"zone", "barangay":"barangay", "barangay_id":"barangayId",
    "municipality_id":"municipalityId", "auth_user_id":"authUserId", "created_by_id":"createdById", "created_by_role":"createdByRole",
    "verification_status":"verificationStatus", "verified_by":"verifiedBy", "verified_at":"verifiedAt", "rejection_reason":"rejectionReason",
    "submitted_for_verification_at":"submittedForVerificationAt", "verification_submitted_by":"verificationSubmittedBy",
    "guardian_status":"guardianStatus", "minor_verification_method":"minorVerificationMethod", "minor_alternative_status":"minorAlternativeStatus",
    "minor_alternative_reason":"minorAlternativeReason", "minor_alternative_reviewed_by":"minorAlternativeReviewedBy",
    "minor_alternative_reviewed_at":"minorAlternativeReviewedAt", "created_at":"createdAt", "updated_at":"updatedAt",
    "client_operation_key":"clientOperationKey"
  }';
begin
  -- The UUID is trusted only behind a signed server JWT and private EXECUTE
  -- grant. auth.uid() on this connection is not the authenticated API actor.
  if auth.role() is distinct from 'service_role' then
    raise exception using errcode = '42501', message = 'Resident registration requires the trusted API.';
  end if;
  select * into actor from public.profiles where id = p_actor_id for share;
  if not found or actor.status <> 'active' or actor.role not in ('health_supervisor', 'phn', 'mho')
    or actor.municipality_id is null or (actor.role = 'health_supervisor' and actor.barangay_id is null) then
    raise exception using errcode = '42501', message = 'An active authorized resident registrar is required.';
  end if;
  select * into personnel from public.personnel_accounts where account_id = p_actor_id for share;
  if (not found and exists (select 1 from auth.users u where u.id = p_actor_id and u.raw_app_meta_data ->> 'personnel_managed' = 'true'))
    or (found and (personnel.approval_status <> 'approved' or personnel.setup_required or personnel.must_change_password
      or personnel.suspended_at is not null
      or (personnel.temporary_password_expires_at is not null and personnel.temporary_password_expires_at <= saved_at))) then
    raise exception using errcode = '42501', message = 'The resident registrar account is not usable.';
  end if;
  if not public.personnel_actor_has_permission(p_actor_id, 'residents.create') then
    raise exception using errcode = '42501', message = 'Resident creation permission is required.';
  end if;
  if jsonb_typeof(p_resident) is distinct from 'object' then
    raise exception using errcode = '22023', message = 'Invalid resident registration.', detail = '{"resident":"A resident object is required."}';
  end if;
  for field in select entry.key, entry.value from jsonb_each(p_resident) as entry loop
    if not fields ? field.key then
      raise exception using errcode = '22023', message = 'Invalid resident registration.',
        detail = '{"resident":"The registration contains an unsupported field."}';
    end if;
    if jsonb_typeof(field.value) = 'null' then continue; end if;
    if (field.key = 'is_4ps_member' and jsonb_typeof(field.value) <> 'boolean')
      or (field.key in ('age', 'zone') and jsonb_typeof(field.value) not in ('number', 'string'))
      or (field.key not in ('is_4ps_member', 'age', 'zone') and jsonb_typeof(field.value) <> 'string') then
      raise exception using errcode = '22023', message = 'Invalid resident registration field.',
        detail = jsonb_build_object(fields ->> field.key, 'Use the expected field type.')::text;
    end if;
  end loop;

  for field in select * from (values
    ('first_name', 'firstName', 80, true, true), ('middle_name', 'middleName', 80, true, false),
    ('last_name', 'lastName', 80, true, true), ('father_name', 'fatherName', 120, true, false),
    ('mother_name', 'motherName', 120, true, false), ('birth_place', 'birthPlace', 120, false, false),
    ('religion', 'religion', 120, false, false), ('employment_status', 'employmentStatus', 120, false, false),
    ('current_address', 'currentAddress', 300, false, false), ('permanent_address', 'permanentAddress', 300, false, false),
    ('philhealth_no', 'philhealthNo', 40, false, false), ('identity_no', 'identityNo', 60, false, false)
  ) as config(db_field, api_field, max_length, is_name, is_required) loop
    value := public.resident_registration_text(p_resident ->> field.db_field, field.api_field,
      field.max_length, field.is_name, field.is_required);
    payload := payload || jsonb_build_object(field.db_field, value);
  end loop;
  for field in select * from (values
    ('suffix', 'suffix', array['', 'Jr.', 'Sr.', 'II', 'III', 'IV', 'V'], false),
    ('sex', 'sex', array['Male', 'Female'], true),
    ('civil_status', 'civilStatus', array['Single', 'Married', 'Widowed', 'Separated'], true)
  ) as config(db_field, api_field, choices, is_required) loop
    value := public.resident_registration_text(p_resident ->> field.db_field, field.api_field, 10, false, field.is_required);
    if not value = any(field.choices) then
      raise exception using errcode = '22023', message = 'Invalid resident registration field.',
        detail = jsonb_build_object(field.api_field, 'Choose a supported value.')::text;
    end if;
    payload := payload || jsonb_build_object(field.db_field, value);
  end loop;
  dob := public.resident_registration_birth_date(p_resident ->> 'birth_date', true);
  completed_age := extract(year from age((saved_at at time zone 'Asia/Manila')::date, dob))::integer;
  is_minor := completed_age < 18;
  value := public.resident_registration_mobile(p_resident ->> 'cellphone_no');
  if value is null then
    raise exception using errcode = '22023', message = 'Invalid resident mobile number.',
      detail = '{"cellphoneNo":"Enter a Philippine mobile number: 09XXXXXXXXX or +639XXXXXXXXX."}';
  end if;
  payload := payload || jsonb_build_object('birth_date', dob, 'cellphone_no', value,
    'is_4ps_member', coalesce((p_resident ->> 'is_4ps_member')::boolean, false));
  value := nullif(p_resident ->> 'zone', '');
  if value is not null and value !~ '^[1-8]$' then
    raise exception using errcode = '22023', message = 'Invalid resident zone.', detail = '{"zone":"Select a zone from 1 to 8."}';
  end if;
  payload := payload || jsonb_build_object('zone', value::integer);
  value := nullif(p_resident ->> 'age', '');
  if value is not null then
    if value !~ '^[0-9]{1,3}$' then
      raise exception using errcode = '22023', message = 'Invalid resident age.', detail = '{"age":"Age must be from 0 to 120."}';
    elsif value::integer > 120 then
      raise exception using errcode = '22023', message = 'Invalid resident age.', detail = '{"age":"Age must be from 0 to 120."}';
    end if;
  end if;

  for field in select entry.key, entry.value from jsonb_each_text(fields) as entry where entry.key in (
    'barangay_id', 'municipality_id', 'auth_user_id', 'verified_by', 'verification_submitted_by', 'minor_alternative_reviewed_by'
  ) loop
    value := nullif(p_resident ->> field.key, '');
    if value is not null and value !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      raise exception using errcode = '22023', message = 'Invalid resident registration reference.',
        detail = jsonb_build_object(field.value, 'Choose a valid reference.')::text;
    end if;
  end loop;
  requested_barangay := nullif(p_resident ->> 'barangay_id', '')::uuid;
  requested_municipality := nullif(p_resident ->> 'municipality_id', '')::uuid;
  invited_user := nullif(p_resident ->> 'auth_user_id', '')::uuid;
  select * into barangay_row from public.barangays where id = requested_barangay for share;
  if not found or barangay_row.status <> 'Active' or not public.is_approved_barangay_name(barangay_row.name) then
    raise exception using errcode = '22023', message = 'Invalid resident barangay.',
      detail = '{"barangay":"Select an active, supported, registered barangay."}';
  end if;
  if requested_municipality is null or requested_municipality is distinct from barangay_row.municipality_id
    or actor.municipality_id is distinct from requested_municipality
    or (actor.role = 'health_supervisor' and actor.barangay_id is distinct from requested_barangay) then
    raise exception using errcode = '42501', message = 'The resident barangay is outside the current assignment.';
  end if;
  perform id from public.municipalities where id = requested_municipality and is_active for share;
  if not found then
    raise exception using errcode = '22023', message = 'Invalid resident municipality.',
      detail = '{"barangay":"Select a barangay in an active municipality."}';
  end if;
  if nullif(btrim(p_resident ->> 'barangay'), '') is not null and btrim(p_resident ->> 'barangay') <> barangay_row.name then
    raise exception using errcode = '22023', message = 'Invalid resident barangay.', detail = '{"barangay":"Use the registered canonical barangay."}';
  end if;
  if invited_user is not null and not public.personnel_actor_has_permission(p_actor_id, 'accounts.create') then
    raise exception using errcode = '42501', message = 'Account creation permission is required.';
  end if;
  if (nullif(p_resident ->> 'created_by_id', '') is not null and p_resident ->> 'created_by_id' <> p_actor_id::text)
    or (nullif(p_resident ->> 'created_by_role', '') is not null and p_resident ->> 'created_by_role' <> actor.role::text)
    or (nullif(p_resident ->> 'verified_by', '')::uuid is not null and (p_resident ->> 'verified_by')::uuid <> p_actor_id)
    or (nullif(p_resident ->> 'verification_submitted_by', '')::uuid is not null and (p_resident ->> 'verification_submitted_by')::uuid <> p_actor_id)
    or (nullif(p_resident ->> 'minor_alternative_reviewed_by', '')::uuid is not null and (p_resident ->> 'minor_alternative_reviewed_by')::uuid <> p_actor_id) then
    raise exception using errcode = '42501', message = 'Resident creator and verification attribution must match the registrar.';
  end if;
  if coalesce(p_resident ->> 'verification_status', 'approved') <> 'approved' or coalesce(p_resident ->> 'rejection_reason', '') <> '' then
    raise exception using errcode = '22023', message = 'Invalid staff verification state.',
      detail = '{"verificationStatus":"Staff in-person registration is approved on creation."}';
  end if;
  if (nullif(p_resident ->> 'guardian_status', '') is not null and (not is_minor or p_resident ->> 'guardian_status' <> 'skipped'))
    or (nullif(p_resident ->> 'minor_verification_method', '') is not null and (not is_minor or p_resident ->> 'minor_verification_method' <> 'staff_alternative'))
    or (nullif(p_resident ->> 'minor_alternative_status', '') is not null and (not is_minor or p_resident ->> 'minor_alternative_status' <> 'approved')) then
    raise exception using errcode = '22023', message = 'Invalid staff minor verification state.',
      detail = '{"minorVerificationMethod":"Minor staff registration uses approved in-person alternative verification."}';
  end if;
  perform public.resident_registration_text(p_resident ->> 'minor_alternative_reason', 'minorAlternativeReason', 1000);
  payload := payload || jsonb_build_object('barangay', barangay_row.name, 'barangay_id', requested_barangay,
    'municipality_id', requested_municipality, 'auth_user_id', invited_user);
  operation_key := nullif(public.resident_registration_text(p_resident ->> 'client_operation_key', 'clientOperationKey', 200), '');
  if operation_key is not null then
    perform pg_advisory_xact_lock(hashtextextended('staff-resident-operation:' || operation_key, 0));
    select * into existing_row from public.residents where client_operation_key = operation_key for share;
    if found then
      if existing_row.municipality_id is distinct from actor.municipality_id
        or (actor.role = 'health_supervisor' and existing_row.barangay_id is distinct from actor.barangay_id) then
        raise exception using errcode = '42501', message = 'The resident registration is outside the current assignment.';
      end if;
      select jsonb_object_agg(key, to_jsonb(existing_row) -> key) into existing_payload from jsonb_object_keys(payload) as keys(key);
      if existing_row.created_by_id is distinct from p_actor_id::text or existing_payload is distinct from payload then
        raise exception using errcode = '23505', message = 'This operation key belongs to a different resident registration.';
      end if;
      return to_jsonb(existing_row);
    end if;
  end if;

  -- Middle name is intentionally absent from the lock: an omitted/blank middle
  -- name is a wildcard in the existing staff duplicate rule. Suffix is ignored.
  perform pg_advisory_xact_lock(hashtextextended(jsonb_build_array('staff-resident-identity',
    requested_municipality, requested_barangay, lower(payload ->> 'first_name'), lower(payload ->> 'last_name'), dob)::text, 0));
  if exists (select 1 from public.residents r
    where r.municipality_id = requested_municipality and r.barangay_id = requested_barangay and r.birth_date = dob
      and lower(public.normalize_resident_registration_name(r.first_name)) = lower(payload ->> 'first_name')
      and lower(public.normalize_resident_registration_name(r.last_name)) = lower(payload ->> 'last_name')
      and (payload ->> 'middle_name' = '' or lower(public.normalize_resident_registration_name(r.middle_name)) = lower(payload ->> 'middle_name'))) then
    raise exception using errcode = '23505', message = 'A matching resident already exists in the selected barangay.',
      detail = '{"firstName":"A resident with this name and date of birth already exists in the selected barangay."}';
  end if;
  if invited_user is not null then
    select * into invited_profile from public.profiles where id = invited_user for update;
    if not found or invited_profile.role not in ('resident', 'resident-limited') or invited_profile.status <> 'pending_verification'
      or exists (select 1 from public.personnel_accounts where account_id = invited_user)
      or (invited_profile.municipality_id is not null and invited_profile.municipality_id <> requested_municipality)
      or (invited_profile.barangay_id is not null and invited_profile.barangay_id <> requested_barangay) then
      raise exception using errcode = '22023', message = 'Invalid resident invitation.',
        detail = '{"authUserId":"Link only an existing pending resident invitation in this scope."}';
    end if;
  end if;
  payload := payload || jsonb_build_object(
    'id', public.resident_registration_text(p_resident ->> 'id', 'id', 100, false, true),
    'health_record_no', public.resident_registration_text(p_resident ->> 'health_record_no', 'healthRecordNo', 100, false, true),
    'age', completed_age, 'created_by_id', p_actor_id::text, 'created_by_role', actor.role::text,
    'verification_status', 'approved', 'verified_by', p_actor_id, 'verified_at', saved_at,
    'verification_submitted_by', case when nullif(p_resident ->> 'verification_submitted_by', '') is not null then p_actor_id end,
    'submitted_for_verification_at', case when nullif(p_resident ->> 'submitted_for_verification_at', '') is not null then saved_at end,
    'guardian_status', case when is_minor then 'skipped' end,
    'minor_verification_method', case when is_minor then 'staff_alternative' end,
    'minor_alternative_status', case when is_minor then 'approved' end,
    'minor_alternative_reason', case when is_minor then coalesce(nullif(public.resident_registration_text(
      p_resident ->> 'minor_alternative_reason', 'minorAlternativeReason', 1000), ''), 'In-person verification by authorized staff.') else '' end,
    'minor_alternative_reviewed_by', case when is_minor then p_actor_id end,
    'minor_alternative_reviewed_at', case when is_minor then saved_at end,
    'client_operation_key', operation_key, 'created_at', saved_at, 'updated_at', saved_at);
  resident_row := jsonb_populate_record(null::public.residents, payload);
  begin
    insert into public.residents (
      id, health_record_no, first_name, middle_name, last_name, suffix, birth_date, age, birth_place, sex, civil_status,
      religion, employment_status, father_name, mother_name, is_4ps_member, philhealth_no, current_address, permanent_address,
      cellphone_no, identity_no, zone, barangay, barangay_id, municipality_id, auth_user_id, created_by_id, created_by_role,
      verification_status, verified_by, verified_at, verification_submitted_by, submitted_for_verification_at,
      guardian_status, minor_verification_method, minor_alternative_status, minor_alternative_reason,
      minor_alternative_reviewed_by, minor_alternative_reviewed_at, client_operation_key, created_at, updated_at
    ) values (
      resident_row.id, resident_row.health_record_no, resident_row.first_name, resident_row.middle_name, resident_row.last_name,
      resident_row.suffix, resident_row.birth_date, resident_row.age, resident_row.birth_place, resident_row.sex, resident_row.civil_status,
      resident_row.religion, resident_row.employment_status, resident_row.father_name, resident_row.mother_name,
      resident_row.is_4ps_member, resident_row.philhealth_no, resident_row.current_address, resident_row.permanent_address,
      resident_row.cellphone_no, resident_row.identity_no, resident_row.zone, resident_row.barangay, resident_row.barangay_id,
      resident_row.municipality_id, resident_row.auth_user_id, resident_row.created_by_id, resident_row.created_by_role,
      resident_row.verification_status, resident_row.verified_by, resident_row.verified_at, resident_row.verification_submitted_by,
      resident_row.submitted_for_verification_at, resident_row.guardian_status, resident_row.minor_verification_method,
      resident_row.minor_alternative_status, resident_row.minor_alternative_reason, resident_row.minor_alternative_reviewed_by,
      resident_row.minor_alternative_reviewed_at, resident_row.client_operation_key, resident_row.created_at, resident_row.updated_at
    ) returning * into resident_row;
  exception when unique_violation then
    raise exception using errcode = '23505', message = 'Resident registration conflicts with an existing record.';
  end;
  -- Linking an invitation may set its canonical geography, but never activate
  -- it. The existing verification-account trigger is UPDATE-only and unchanged.
  if invited_user is not null then
    update public.profiles set municipality_id = requested_municipality, barangay_id = requested_barangay where id = invited_user;
  end if;
  return to_jsonb(resident_row);
end;
$$;

revoke all on function public.normalize_resident_registration_name(text) from public, anon, authenticated;

revoke all on function public.resident_registration_name_is_valid(text) from public, anon, authenticated;

revoke all on function public.resident_registration_text(text, text, integer, boolean, boolean) from public, anon, authenticated;

revoke all on function public.resident_registration_mobile(text) from public, anon, authenticated;

revoke all on function public.resident_registration_birth_date(text, boolean) from public, anon, authenticated;

revoke all on function public.guard_resident_registration_fields() from public, anon, authenticated;

revoke all on function public.register_staff_resident(uuid, jsonb) from public, anon, authenticated;

grant execute on function public.register_staff_resident(uuid, jsonb) to service_role;

notify pgrst, 'reload schema';

commit;
