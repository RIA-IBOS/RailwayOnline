[
  {
    "staBuildingID": "车站建筑ID",   //<string>车站建筑编号，命名方法待定，用于唯一索引
    "staBuildingName":"车站建筑名",   //<string>车站建筑名，用于为页面Label提供文本信息，可与其他站台名重复(用于多站台车站)
        "Conpoints": [                //组成该建筑轮廓的所有控制点,y值若无则默认为0，便于其他方式的数据导入
            [x,y,z],
            [x,y,z],
            [x,y,z],
            ...
        ],    
    "heightH":"y轴坐标",          //<float>(非必要)车站建筑的高度
    "labelL1":标识种类1,          //<integer>用于label根据数值判断使用label等级所用(1=xxx,2=xxx,3=xxx)
    "labelL2":标识种类2,          //<integer>同上，仅备用  
    "labelL3":标识种类3,          //<integer>同上，仅备用         
    "platforms": [                  //包含楼层及特殊情况
      {
        "condistance": 合并比例        //<integer>当缩放等级到大于某个等级时显示，反之则不显示
        "BuildingLevelID": 建筑楼层ID        //<string>建筑楼层ID，用于包含显示
      }
    ]
  },
]