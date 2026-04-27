import { Form, Input, Button } from "antd";
import "./login.scss";
import axiosClient from "../../api/axiosClient";
import { useDispatch } from "react-redux";
import { setCredentials } from "../../features/authSlice";
import { useNavigate } from "react-router-dom";

const Login = () => {
  const dispatch = useDispatch();
  const navigate = useNavigate();

  const onFinish = async (values) => {
    try {
      const res = await axiosClient.post("/auth/login", values);

      dispatch(
        setCredentials({
          accessToken: res.data.accessToken,
        })
      );

      navigate("/");
    } catch (err) {
      console.log(err);
    }
  };

  return (
    <div className="login">
      <Form onFinish={onFinish}>
        <Form.Item name="email" rules={[{ required: true }]}>
          <Input placeholder="Email" />
        </Form.Item>

        <Form.Item name="password" rules={[{ required: true }]}>
          <Input.Password placeholder="Password" />
        </Form.Item>

        <Button type="primary" htmlType="submit">
          Login
        </Button>
      </Form>
    </div>
  );
};

export default Login;