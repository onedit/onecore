cd "$(dirname "$0")"
cp ../../collada/src/* ../external
cp ../../litegl/build/* ../external
cp ../../canvas2DtoWebGL/src/Canvas2DtoWebGL.js ../external
python builder.py deploy_files.txt -o ../build/onecore.min.js -o2 ../build/onecore.js --nomin
chmod a+rw ../build/*
