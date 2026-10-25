官方格式验证夹具：`zmk-v0.3-keys.h` 原样来自 https://raw.githubusercontent.com/zmkfirmware/zmk/v0.3/app/include/dt-bindings/zmk/keys.h ，保留原版权与 MIT 许可声明。仅用于离线核对生成器键码名称。

RP2040 引脚映射夹具，原样保留版权与许可，用于离线核对界面 GPIO 与生成的 QMK / ZMK 接线是否一致：

- `qmk-0.34.7-sparkfun-pm2040-pins.h`：https://github.com/qmk/qmk_firmware/blob/0.34.7/platforms/chibios/converters/promicro_to_sparkfun_pm2040/_pin_defs.h
- `zmk-zephyr-sparkfun-pro-micro-connector.dtsi`：https://github.com/zmkfirmware/zephyr/blob/v3.5.0%2Bzmk-fixes/boards/arm/sparkfun_pro_micro_rp2040/sparkfun_pro_micro_connector.dtsi

ZMK `v0.3` 的 `app/west.yml` 指定 Zephyr 分支 `v3.5.0+zmk-fixes`。以上两份映射已交叉核对，18 个接口全部一致。
